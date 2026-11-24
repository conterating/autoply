import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { Page } from "playwright";

import type { FieldAnswer, FieldType } from "../types.ts";

/**
 * DOM helpers for Workday (myworkdayjobs.com) candidate pages. Workday marks
 * everything with `data-automation-id`:
 *  - a form field is a `[data-automation-id="formField-<id>"]` container with a
 *    label and one control;
 *  - dropdowns are `button[aria-haspopup=listbox]` that open a `role=listbox`
 *    popup of `role=option` items (only in the DOM while open);
 *  - the application is a sequence of pages tracked by
 *    `[data-automation-id=progressBar]`; `bottom-navigation-next-button` is
 *    "Save and Continue" and `pageFooterSubmitButton` is the final "Submit";
 *  - validation messages are `[data-automation-id=errorMessage]`.
 */

const SEL = {
  progressBar: '[data-automation-id="progressBar"]',
  activeStep: '[data-automation-id="progressBarActiveStep"], [data-automation-id="progressBar"] [aria-current="step"]',
  pageHeader: '[data-automation-id="pageHeader"]',
  next: '[data-automation-id="bottom-navigation-next-button"]',
  submit: '[data-automation-id="pageFooterSubmitButton"]',
  error: '[data-automation-id="errorMessage"]',
  listbox: '[role="listbox"]',
  option: '[role="listbox"] [role="option"]',
  apply: '[data-automation-id="adventureButton"]',
  applyManually: '[data-automation-id="applyManually"]',
  signInSubmit: '[data-automation-id="signInSubmitButton"]',
  createSubmit: '[data-automation-id="createAccountSubmitButton"]',
  signInLink: '[data-automation-id="signInLink"]',
  createLink: '[data-automation-id="createAccountLink"]',
  verify: '[data-automation-id="verifyEmailHeading"]',
  submitted: '[data-automation-id="applicationSubmittedHeading"]',
  captcha: 'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[title*="captcha" i], .g-recaptcha, .h-captcha, [data-sitekey]',
} as const;
export { SEL as WORKDAY_SELECTORS };

const CLOSED_RE = /page you are looking for doesn'?t exist|no longer (available|open|accepting)|position has been filled|job (posting )?(is )?(closed|no longer)/i;
const SHORT_TIMEOUT = 10_000;

export type WorkdayView = "posting" | "choice" | "signin" | "create" | "verify" | "application" | "submitted" | "unknown";

export async function detectView(page: Page): Promise<WorkdayView> {
  return page.evaluate((s) => {
    const has = (q: string) => document.querySelector(q) !== null;
    if (has(s.submitted)) return "submitted";
    if (has(s.progressBar)) return "application";
    if (has(s.verify)) return "verify";
    if (has(s.createSubmit)) return "create";
    if (has(s.signInSubmit)) return "signin";
    if (has(s.applyManually)) return "choice";
    if (has(s.apply)) return "posting";
    return "unknown";
  }, SEL);
}

/** Waits until the page shows one of the known Workday views (or the timeout passes). */
export async function settle(page: Page, timeout = SHORT_TIMEOUT): Promise<WorkdayView> {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  const known = [SEL.submitted, SEL.progressBar, SEL.verify, SEL.createSubmit, SEL.signInSubmit, SEL.applyManually, SEL.apply].join(", ");
  await page.locator(known).first().waitFor({ state: "attached", timeout }).catch(() => undefined);
  return detectView(page);
}

export async function closedMessage(page: Page): Promise<string | null> {
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const m = CLOSED_RE.exec(text);
  if (!m) return null;
  const line = text.split("\n").find((l) => CLOSED_RE.test(l));
  return (line ?? m[0]).trim();
}

export async function hasCaptcha(page: Page): Promise<boolean> {
  return (await page.locator(SEL.captcha).count()) > 0;
}

export async function readErrors(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    document.querySelectorAll(sel).forEach((el) => {
      const text = (el.textContent ?? "").replace(/^\s*Error:\s*/i, "").replace(/\s+/g, " ").trim();
      if (!text) return;
      const container = el.closest('[data-automation-id^="formField-"]');
      const label = container?.querySelector("label, legend, .lbl")?.textContent?.replace(/\*/g, "").replace(/\s+/g, " ").trim();
      out.push(label && !text.toLowerCase().includes(label.toLowerCase().replace(/[?:]$/, "")) ? `${label}: ${text}` : text);
    });
    return out;
  }, SEL.error);
}

export type PageInfo = { index: number; title: string; review: boolean };

export async function currentPage(page: Page): Promise<PageInfo> {
  return page.evaluate((s) => {
    const steps = Array.from(document.querySelectorAll(`${s.progressBar} li`));
    const active = document.querySelector(s.activeStep);
    const header = document.querySelector(s.pageHeader)?.textContent ?? document.querySelector("h2")?.textContent ?? active?.textContent ?? "";
    const title = header.replace(/^\s*\d+\.\s*/, "").replace(/\s+/g, " ").trim();
    const index = active ? steps.findIndex((li) => li === active || li.contains(active)) : 0;
    return { index: Math.max(0, index), title, review: document.querySelector(s.submit) !== null || /^review\b/i.test(title) };
  }, { progressBar: SEL.progressBar, activeStep: SEL.activeStep, pageHeader: SEL.pageHeader, submit: SEL.submit });
}

// ------------------------------------------------------------------ fields

export type RawField = {
  id: string;
  label: string;
  required: boolean;
  type: FieldType;
  /** Radio options (value + label). Dropdown options need the popup opened. */
  options?: { value: string; label: string }[];
  /** Whether the control currently holds a value. */
  filled: boolean;
  /** Stray file inputs (not inside a formField container) are addressed by this selector. */
  selector?: string;
};

export async function scanFields(page: Page): Promise<RawField[]> {
  return page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s ?? "").replace(/\*/g, " ").replace(/\s+/g, " ").trim();
    const out: RawField[] = [];
    document.querySelectorAll('[data-automation-id^="formField-"]').forEach((c) => {
      const id = (c.getAttribute("data-automation-id") ?? "").slice("formField-".length);
      const dd = c.querySelector('button[aria-haspopup="listbox"]');
      const fileIn = c.querySelector('input[type="file"]');
      const radios = Array.from(c.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
      const cb = c.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      const ta = c.querySelector("textarea") as HTMLTextAreaElement | null;
      const inp = c.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"])') as HTMLInputElement | null;
      const group = c.querySelector('[role="radiogroup"]');
      const ctl: Element | null = dd ?? fileIn ?? cb ?? ta ?? inp ?? radios[0] ?? null;
      if (!ctl) return;

      let labelEl: Element | null = null;
      if (radios.length && group) {
        const by = group.getAttribute("aria-labelledby");
        labelEl = by ? document.getElementById(by.split(/\s+/)[0]!) : null;
      } else if (ctl.id) {
        labelEl = c.querySelector(`label[for="${ctl.id}"]`);
      }
      if (!labelEl) {
        const by = ctl.getAttribute("aria-labelledby");
        labelEl = by ? document.getElementById(by.split(/\s+/)[0]!) : null;
      }
      if (!labelEl) labelEl = c.querySelector("label, legend, .lbl");
      const labelRaw = labelEl?.textContent ?? ctl.getAttribute("aria-label") ?? "";
      const required =
        labelRaw.includes("*") || ctl.hasAttribute("required") || ctl.getAttribute("aria-required") === "true" || group?.getAttribute("aria-required") === "true";

      let type: FieldType = "text";
      let options: RawField["options"];
      let filled = false;
      if (dd) {
        type = "select";
        const hidden = c.querySelector('input[type="hidden"]') as HTMLInputElement | null;
        filled = hidden ? hidden.value !== "" : !/^select/i.test((dd.textContent ?? "").trim());
      } else if (fileIn) {
        type = "file";
        filled = ((fileIn as HTMLInputElement).files?.length ?? 0) > 0 || c.querySelector('[data-automation-id="file-upload-successful"]') !== null;
      } else if (radios.length) {
        type = "radio";
        options = radios.map((r) => ({ value: r.value, label: clean(c.querySelector(`label[for="${r.id}"]`)?.textContent ?? r.value) }));
        filled = radios.some((r) => r.checked);
      } else if (cb) {
        type = "checkbox";
        filled = cb.checked;
      } else if (ta) {
        type = "textarea";
        filled = ta.value.trim() !== "";
      } else if (inp) {
        const t = inp.type;
        type = t === "tel" ? "tel" : t === "email" ? "email" : t === "number" ? "number" : t === "date" ? "date" : "text";
        filled = inp.value.trim() !== "";
      }
      out.push({ id, label: clean(labelRaw), required, type, options, filled });
    });
    // Resume uploads outside a formField container (older Workday tenants).
    document.querySelectorAll('input[type="file"]').forEach((f, i) => {
      if (f.closest('[data-automation-id^="formField-"]')) return;
      const heading = f.closest("section, div")?.querySelector("h1, h2, h3, h4, label")?.textContent;
      out.push({
        id: f.getAttribute("data-automation-id") === "file-upload-input-ref" && i === 0 ? "resume" : (f.id || `file-${i}`),
        label: clean(f.getAttribute("aria-label") ?? heading ?? "Resume/CV"),
        required: false,
        type: "file",
        filled: ((f as HTMLInputElement).files?.length ?? 0) > 0,
        selector: `input[type="file"] >> nth=${i}`,
      });
    });
    return out;
  });
}

const container = (page: Page, id: string) => page.locator(`[data-automation-id="formField-${id}"]`);

/** Opens a dropdown, runs `fn` against its (briefly existing) listbox, then closes it. */
async function withListbox<T>(page: Page, id: string, fn: () => Promise<T>): Promise<T> {
  const button = container(page, id).locator('button[aria-haspopup="listbox"]').first();
  await button.click();
  await page.locator(SEL.option).first().waitFor({ state: "visible", timeout: SHORT_TIMEOUT });
  try {
    return await fn();
  } finally {
    if ((await page.locator(SEL.listbox).count()) > 0) {
      await page.keyboard.press("Escape");
      await page.locator(SEL.listbox).first().waitFor({ state: "detached", timeout: 3000 }).catch(() => undefined);
    }
  }
}

/** Reads a dropdown's options by opening it (Escape closes without selecting). */
export async function readDropdownOptions(page: Page, id: string): Promise<{ value: string; label: string }[]> {
  return withListbox(page, id, async () => {
    const texts = await page.locator(SEL.option).allInnerTexts();
    return texts.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean).map((label) => ({ value: label, label }));
  });
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
};

export async function fillField(page: Page, f: RawField, answer: FieldAnswer): Promise<void> {
  const where = `Workday field "${f.label}"`;
  const wrap = f.selector ? page.locator(f.selector) : container(page, f.id);
  switch (f.type) {
    case "select": {
      if (answer.kind !== "option" || !answer.values[0]) throw new Error(`${where} is a dropdown but got a ${answer.kind} answer`);
      const wanted = norm(answer.values[0]);
      await withListbox(page, f.id, async () => {
        const texts = (await page.locator(SEL.option).allInnerTexts()).map(norm);
        const idx = texts.indexOf(wanted);
        if (idx < 0) throw new Error(`${where} has no option "${wanted}" (options: ${texts.slice(0, 8).join(" | ")}${texts.length > 8 ? " | …" : ""})`);
        await page.locator(SEL.option).nth(idx).click();
      });
      const shown = norm((await wrap.locator('button[aria-haspopup="listbox"]').first().innerText()) ?? "");
      if (shown !== wanted) throw new Error(`${where}: selected "${wanted}" but the page shows "${shown}"`);
      return;
    }
    case "radio": {
      if (answer.kind !== "option" || !answer.values[0]) throw new Error(`${where} is a radio group but got a ${answer.kind} answer`);
      const value = answer.values[0];
      const opt = f.options?.find((o) => o.value === value || o.label === value);
      if (!opt) throw new Error(`${where} has no option "${value}"`);
      const input = wrap.locator(`input[type="radio"][value="${opt.value.replace(/"/g, '\\"')}"]`).first();
      const id = await input.getAttribute("id");
      const label = id ? wrap.locator(`label[for="${id}"]`).first() : null;
      if (label && (await label.count()) > 0) await label.click();
      else await input.check({ force: true });
      if (!(await input.isChecked())) await input.check({ force: true });
      return;
    }
    case "checkbox": {
      if (answer.kind !== "boolean") throw new Error(`${where} is a checkbox but got a ${answer.kind} answer`);
      await wrap.locator('input[type="checkbox"]').first().setChecked(answer.value, { force: true });
      return;
    }
    case "file": {
      if (answer.kind !== "file") throw new Error(`${where} is a file upload but got a ${answer.kind} answer`);
      const buffer = readFileSync(answer.path);
      const input = f.selector ? page.locator(f.selector) : wrap.locator('input[type="file"]').first();
      await input.setInputFiles({ name: answer.filename, mimeType: MIME[extname(answer.filename).toLowerCase()] ?? "application/octet-stream", buffer });
      // Workday shows the uploaded file once it is accepted.
      await wrap
        .locator('[data-automation-id="file-upload-successful"], [data-automation-id="file-upload-item"] >> text=/\\S/')
        .first()
        .waitFor({ state: "attached", timeout: 5000 })
        .catch(() => undefined);
      return;
    }
    default: {
      if (answer.kind !== "text") throw new Error(`${where} is a text field but got a ${answer.kind} answer`);
      await wrap.locator("textarea, input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file])").first().fill(answer.value);
    }
  }
}

/**
 * Clicks a navigation button and waits for the next page (or for validation
 * errors) to appear. Works for full page loads and for in-place updates.
 */
export async function clickAndSettle(page: Page, button: ReturnType<Page["locator"]>): Promise<void> {
  const before = await page.evaluate((s) => {
    (window as unknown as { __wdNav?: boolean }).__wdNav = true;
    const errs = Array.from(document.querySelectorAll(s.error)).map((e) => e.textContent).join("|");
    const step = document.querySelector(s.pageHeader)?.textContent ?? "";
    return `${step}#${errs}`;
  }, { error: SEL.error, pageHeader: SEL.pageHeader });
  await button.click();
  await page
    .waitForFunction(
      ([s, prev]) => {
        if (!(window as unknown as { __wdNav?: boolean }).__wdNav) return true;
        const errs = Array.from(document.querySelectorAll(s.error)).map((e) => e.textContent).join("|");
        const step = document.querySelector(s.pageHeader)?.textContent ?? "";
        return `${step}#${errs}` !== prev;
      },
      [{ error: SEL.error, pageHeader: SEL.pageHeader }, before] as const,
      { timeout: SHORT_TIMEOUT },
    )
    .catch(() => undefined);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

export function nextButton(page: Page) {
  return page.locator(SEL.next).or(page.getByRole("button", { name: /^save and continue$/i })).first();
}

export function submitButton(page: Page) {
  return page.locator(SEL.submit).or(page.getByRole("button", { name: /^submit$/i })).first();
}

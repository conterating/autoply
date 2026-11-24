/** DOM helpers for Ashby application forms (jobs.ashbyhq.com and the fixture replica). */
import type { Page } from "playwright";

import type { FieldAnswer, FormField } from "@autoply/core";

const YES_NO = [
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];

/**
 * Runs in the browser. Self-contained: no closures over module scope.
 * Walks the form once and returns every field, including those in later (hidden) steps,
 * but not hidden conditional fields.
 */
function collectFieldsInPage(yesNoOptions: { value: string; label: string }[]): FormField[] {
  const form: Element = document.querySelector("form") ?? document.body;
  const stepEls = Array.from(form.querySelectorAll<HTMLElement>("[data-step], [id^='step-']")).filter(
    (e) => e.hasAttribute("data-step") || /^step-\d+$/.test(e.id),
  );
  const multi = stepEls.length > 1;

  const cleanText = (el: Element | null): { text: string; star: boolean } => {
    if (!el) return { text: "", star: false };
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll("input,select,textarea,button").forEach((n) => n.remove());
    const star = clone.querySelector(".req, [class*='required']") !== null;
    clone.querySelectorAll("[aria-hidden='true']").forEach((n) => n.remove());
    const raw = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
    const hasStar = star || /\*\s*$/.test(raw) || (el.textContent ?? "").replace(/\s+/g, " ").trim().endsWith("*");
    return { text: raw.replace(/\s*\*+\s*$/, "").trim(), star: hasStar };
  };
  const byIds = (ids: string | null): { text: string; star: boolean } | null => {
    if (!ids) return null;
    const parts = ids
      .split(/\s+/)
      .map((id) => cleanText(document.getElementById(id)))
      .filter((p) => p.text);
    if (!parts.length) return null;
    return { text: parts.map((p) => p.text).join(" "), star: parts.some((p) => p.star) };
  };
  const labelFor = (el: Element): { text: string; star: boolean } => {
    const byLabelled = byIds(el.getAttribute("aria-labelledby"));
    if (byLabelled) return byLabelled;
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const t = cleanText(l);
      if (t.text) return t;
    }
    const wrap = cleanText(el.closest("label"));
    if (wrap.text) return wrap;
    const legend = cleanText(el.closest("fieldset")?.querySelector("legend") ?? null);
    if (legend.text) return legend;
    return { text: (el.getAttribute("aria-label") ?? "").trim(), star: false };
  };
  const groupLabel = (el: Element): { text: string; star: boolean; required: boolean } => {
    const g = el.closest("fieldset, [role=radiogroup], [role=group]");
    if (g) {
      const l = byIds(g.getAttribute("aria-labelledby")) ?? cleanText(g.querySelector("legend")) ?? { text: "", star: false };
      const text = l.text ? l : { text: (g.getAttribute("aria-label") ?? "").trim(), star: false };
      if (text.text) return { ...text, required: g.getAttribute("aria-required") === "true" };
    }
    const l = labelFor(el);
    return { ...l, required: false };
  };
  const helpFor = (el: Element): string | undefined => {
    const t = byIds(el.getAttribute("aria-describedby"));
    return t?.text || undefined;
  };
  const stepIndex = (el: Element): number => {
    for (let i = 0; i < stepEls.length; i++) if (stepEls[i]!.contains(el)) return i;
    return 0;
  };
  const inHiddenConditional = (el: Element): boolean => {
    for (let p: Element | null = el; p && p !== form.parentElement; p = p.parentElement) {
      if (stepEls.includes(p as HTMLElement)) continue;
      if (p.hasAttribute("hidden") || p.getAttribute("aria-hidden") === "true" || p.hasAttribute("data-depends-on") && (p as HTMLElement).hidden) return true;
    }
    return false;
  };

  const out: FormField[] = [];
  const consumed = new Set<Element>();
  const groups = new Map<string, FormField & { _members: number }>();
  const push = (f: FormField, el: Element) => {
    if (multi) f.page = stepIndex(el);
    out.push(f);
  };

  for (const el of Array.from(form.querySelectorAll("input, textarea, select, [role=group]"))) {
    if (consumed.has(el) || inHiddenConditional(el)) continue;

    if (el.getAttribute("role") === "group") {
      const hidden = el.querySelector<HTMLInputElement>("input[type=hidden]");
      const buttons = el.querySelectorAll("button");
      if (!hidden || buttons.length < 2 || !hidden.name) continue;
      consumed.add(hidden);
      const l = byIds(el.getAttribute("aria-labelledby")) ?? { text: (el.getAttribute("aria-label") ?? "").trim(), star: false };
      push(
        {
          id: hidden.name,
          label: l.text,
          type: "radio",
          required: el.getAttribute("aria-required") === "true" || l.star,
          options: yesNoOptions.map((o) => ({ ...o })),
        },
        el,
      );
      continue;
    }

    const input = el as HTMLInputElement;
    const type = (input.type || "text").toLowerCase();
    if (el.tagName === "INPUT" && ["hidden", "submit", "button", "image", "reset"].includes(type)) continue;
    const name = input.name || input.id;
    if (!name) continue;
    const own = labelFor(el);
    const required = input.required || el.getAttribute("aria-required") === "true";

    if (type === "radio" || type === "checkbox") {
      const key = `${type}:${name}`;
      let g = groups.get(key);
      const optText = (own.text || input.value).trim();
      if (!g) {
        const gl = groupLabel(el);
        g = {
          id: name,
          label: gl.text || own.text,
          type: type as "radio" | "checkbox",
          required: required || gl.required || gl.star,
          options: [],
          ...(type === "checkbox" ? { multiple: true } : {}),
          _members: 0,
        };
        const help = helpFor(el);
        if (help) g.helpText = help;
        groups.set(key, g);
        push(g, el);
      } else if (required) g.required = true;
      g._members++;
      g.options!.push({ value: input.value, label: optText });
      continue;
    }

    let ftype: FormField["type"] = "text";
    if (el.tagName === "TEXTAREA") ftype = "textarea";
    else if (el.tagName === "SELECT") ftype = "select";
    else if (type === "file") ftype = "file";
    else if (["email", "tel", "number", "date"].includes(type)) ftype = type as FormField["type"];
    const field: FormField = { id: name, label: own.text, type: ftype, required: required || own.star };
    const help = helpFor(el);
    if (help) field.helpText = help;
    if (ftype === "select") {
      field.options = Array.from((el as HTMLSelectElement).options)
        .filter((o) => o.value !== "")
        .map((o) => ({ value: o.value, label: (o.textContent ?? "").trim() }));
    }
    push(field, el);
  }

  // A lone checkbox is a plain yes/no consent box, not a group.
  for (const g of groups.values()) {
    if (g.type === "checkbox" && g._members === 1) {
      const only = g.options![0]!;
      g.label = only.label || g.label;
      delete g.options;
      delete g.multiple;
    }
  }
  return out.map((f) => {
    const { _members, ...rest } = f as FormField & { _members?: number };
    void _members;
    return rest;
  });
}

export async function extractAshbyFields(page: Page): Promise<FormField[]> {
  await page.waitForSelector("form input, form textarea, form select", { timeout: 15_000 }).catch(() => undefined);
  return page.evaluate(collectFieldsInPage, YES_NO);
}

// ------------------------------------------------------------------ steps

/** 0-based index of the visible step, or -1 for single-page forms. */
export async function currentStep(page: Page): Promise<number> {
  return page.evaluate(() => {
    const steps = Array.from(document.querySelectorAll<HTMLElement>("[data-step], [id^='step-']")).filter(
      (e) => e.hasAttribute("data-step") || /^step-\d+$/.test(e.id),
    );
    if (steps.length < 2) return -1;
    const i = steps.findIndex((s) => !s.hidden && s.getClientRects().length > 0);
    return i;
  });
}

const NEXT = /^\s*(next|continue)\s*$/i;
const BACK = /^\s*(back|previous)\s*$/i;

async function visibleButton(page: Page, name: RegExp) {
  const b = page.getByRole("button", { name });
  const n = await b.count();
  for (let i = 0; i < n; i++) if (await b.nth(i).isVisible()) return b.nth(i);
  return null;
}

export async function hasNext(page: Page): Promise<boolean> {
  return (await visibleButton(page, NEXT)) !== null;
}

async function stepErrorText(page: Page): Promise<string> {
  const alerts = page.locator("[role=alert]:visible");
  const n = await alerts.count();
  const texts: string[] = [];
  for (let i = 0; i < n; i++) texts.push(((await alerts.nth(i).textContent()) ?? "").trim());
  return texts.filter(Boolean).join("; ");
}

/** Moves to the given step using Next/Back. */
export async function gotoStep(page: Page, target: number): Promise<void> {
  for (let guard = 0; guard < 12; guard++) {
    const cur = await currentStep(page);
    if (cur < 0 || cur === target) return;
    if (cur < target) {
      const next = await visibleButton(page, NEXT);
      if (!next) throw new Error(`Ashby: cannot reach step ${target + 1}: no Next button on step ${cur + 1}`);
      await next.click();
    } else {
      const back = await visibleButton(page, BACK);
      if (!back) throw new Error(`Ashby: cannot return to step ${target + 1}: no Back button on step ${cur + 1}`);
      await back.click();
    }
    const moved = await page
      .waitForFunction(
        (c) => {
          const steps = Array.from(document.querySelectorAll<HTMLElement>("[data-step], [id^='step-']")).filter(
            (e) => e.hasAttribute("data-step") || /^step-\d+$/.test(e.id),
          );
          return steps.findIndex((s) => !s.hidden && s.getClientRects().length > 0) !== c;
        },
        cur,
        { timeout: 3000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!moved) {
      const err = await stepErrorText(page);
      throw new Error(`Ashby: step ${cur + 1} did not advance${err ? `: ${err}` : ""}`);
    }
  }
  throw new Error(`Ashby: could not navigate to step ${target + 1}`);
}

// ------------------------------------------------------------------ filling

const q = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function optionValues(a: FieldAnswer, field: FormField): string[] {
  if (a.kind === "option") return a.values;
  if (a.kind === "boolean") return [a.value ? "Yes" : "No"];
  if (a.kind === "text") return [a.value];
  throw new Error(`Ashby: field "${field.label}" (${field.id}) needs an option answer, got ${a.kind}`);
}

function matchOption(field: FormField, wanted: string): string {
  const opts = field.options ?? [];
  const w = wanted.trim().toLowerCase();
  const hit = opts.find((o) => o.value === wanted) ?? opts.find((o) => o.value.toLowerCase() === w || o.label.toLowerCase() === w);
  if (!hit) throw new Error(`Ashby: no option "${wanted}" for "${field.label}" (${field.id}); available: ${opts.map((o) => o.label).join(", ")}`);
  return hit.value;
}

/** Fills one field on the currently visible step. */
export async function fillAshbyField(page: Page, field: FormField, answer: FieldAnswer): Promise<void> {
  const sel = `[name="${q(field.id)}"]`;
  const where = `"${field.label}" (${field.id})`;
  const loc = page.locator(sel);
  if ((await loc.count()) === 0) throw new Error(`Ashby: field ${where} not found on page`);

  if (field.type === "file") {
    if (answer.kind !== "file") throw new Error(`Ashby: field ${where} needs a file answer`);
    await loc.first().setInputFiles(answer.path);
    return;
  }

  if (field.type === "radio") {
    const [wanted] = optionValues(answer, field);
    if (wanted === undefined) throw new Error(`Ashby: empty answer for ${where}`);
    const value = matchOption(field, wanted);
    const hidden = page.locator(`input[type=hidden]${sel}`);
    if ((await hidden.count()) > 0) {
      const group = page.locator(`[role=group]:has(input[type=hidden]${sel})`).first();
      const btn = group.getByRole("button", { name: new RegExp(`^\\s*${value}\\s*$`, "i") });
      if ((await btn.count()) === 0) throw new Error(`Ashby: no "${value}" button for ${where}`);
      await btn.first().click();
      const ok = await page
        .waitForFunction(
          ({ s, v }) => (document.querySelector<HTMLInputElement>(`input[type=hidden]${s}`)?.value ?? "") === v,
          { s: sel, v: value },
          { timeout: 3000 },
        )
        .then(() => true)
        .catch(() => false);
      const pressed = await btn.first().getAttribute("aria-pressed");
      if (!ok || pressed === "false") throw new Error(`Ashby: clicking "${value}" did not register for ${where}`);
    } else {
      const radio = page.locator(`input[type=radio]${sel}[value="${q(value)}"]`);
      await radio.check();
    }
    await page.waitForTimeout(60);
    return;
  }

  if (field.type === "checkbox") {
    const boxes = page.locator(`input[type=checkbox]${sel}`);
    if (!field.options?.length) {
      if (answer.kind !== "boolean") throw new Error(`Ashby: checkbox ${where} needs a boolean answer`);
      await boxes.first().setChecked(answer.value);
      return;
    }
    const wanted = new Set(optionValues(answer, field).map((v) => matchOption(field, v)));
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      const box = boxes.nth(i);
      const v = await box.getAttribute("value");
      await box.setChecked(wanted.has(v ?? ""));
    }
    for (let i = 0; i < n; i++) {
      const v = (await boxes.nth(i).getAttribute("value")) ?? "";
      if ((await boxes.nth(i).isChecked()) !== wanted.has(v)) throw new Error(`Ashby: checkbox "${v}" for ${where} did not stick`);
    }
    return;
  }

  if (field.type === "select") {
    const [wanted] = optionValues(answer, field);
    if (wanted === undefined) throw new Error(`Ashby: empty answer for ${where}`);
    await loc.first().selectOption(matchOption(field, wanted));
    return;
  }

  if (answer.kind !== "text") throw new Error(`Ashby: text field ${where} needs a text answer, got ${answer.kind}`);
  await loc.first().fill(answer.value);
}

// ------------------------------------------------------------------ page state

export const CAPTCHA_SELECTOR = ".h-captcha, .g-recaptcha, [data-sitekey], iframe[title*='captcha' i], iframe[src*='recaptcha'], iframe[src*='hcaptcha'], textarea[name='h-captcha-response'], textarea[name='g-recaptcha-response']";

export async function hasCaptcha(page: Page): Promise<boolean> {
  return (await page.locator(CAPTCHA_SELECTOR).count()) > 0;
}

export const CLOSED_TEXT = /no longer accepting|job (you requested )?(was|is) not found|job not found|page (was )?not found|no longer available|404/i;

export async function closedMessage(page: Page): Promise<string | null> {
  const text = ((await page.locator("body").innerText().catch(() => "")) ?? "").trim();
  if (await page.locator("form input, form textarea").count()) return null;
  if (CLOSED_TEXT.test(text.slice(0, 600))) return text.split("\n").find((l) => l.trim())?.trim() ?? "Job not found";
  return null;
}

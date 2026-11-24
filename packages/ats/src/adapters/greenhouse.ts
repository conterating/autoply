import type { Page } from "playwright";

import { fetchBoard } from "../discovery/greenhouse.ts";
import type { AtsAdapter, FieldAnswer, FormField, NormalizedPosting, PageState, SubmitOutcome } from "../types.ts";
import { extractRaw, fillField, postedNames, readComboboxOptions, waitForDependents } from "./greenhouse-dom.ts";

const FORM_SEL = "#application-form, form";
const CAPTCHA_SEL = ".h-captcha, iframe[title*=captcha i], .g-recaptcha";
const CLOSED_RE = /no longer accepting applications|job (post(ing)? )?(is )?(not found|no longer (available|open))|page not found|this (job|posting) (has been|is) (closed|removed)/i;
const CONFIRM_RE = /thank you for applying|application submitted|successfully submitted|your application has been (submitted|received)/i;
const ERROR_RE = /something went wrong|internal server error|service unavailable|bad gateway/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs a page read, retrying when a navigation destroys the execution context mid-call. */
async function safe<T>(page: Page, fn: () => Promise<T>, fallback: T): Promise<T> {
  for (let i = 0; i < 4; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!/context was destroyed|navigation|Target closed/i.test(String(err))) throw err;
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    }
  }
  return fallback;
}

const bodyText = (page: Page) => page.evaluate("document.body ? document.body.innerText : ''") as Promise<string>;

async function hasCaptcha(page: Page): Promise<boolean> {
  return (await page.evaluate(
    `(() => { var root = document.querySelector('#application-form') || document.querySelector('form') || document;
      return [].slice.call(root.querySelectorAll(${JSON.stringify(CAPTCHA_SEL)})).some(function (e) { return !e.closest('.grecaptcha-badge'); }); })()`,
  )) as boolean;
}

async function alertMessages(page: Page): Promise<string[]> {
  return (await page.evaluate(
    `[].slice.call(document.querySelectorAll('[role=alert]')).map(function (a) {
      var items = [].slice.call(a.querySelectorAll('li')).map(function (l) { return l.textContent.replace(/\\s+/g, ' ').trim(); }).filter(Boolean);
      return items.length ? items : [a.textContent.replace(/\\s+/g, ' ').trim()];
    }).reduce(function (acc, x) { return acc.concat(x); }, []).filter(Boolean)`,
  )) as string[];
}

async function hasForm(page: Page): Promise<boolean> {
  return (await page.locator(FORM_SEL).count()) > 0;
}

export const greenhouseAdapter: AtsAdapter = {
  kind: "greenhouse",

  discover(board): Promise<NormalizedPosting[]> {
    return fetchBoard(board);
  },

  async open(page, url): Promise<PageState> {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator(FORM_SEL).first().waitFor({ timeout: 4000 }).catch(() => undefined);

    if (!(await hasForm(page))) {
      const text = await bodyText(page);
      if (resp?.status() === 404 || CLOSED_RE.test(text)) {
        const m = CLOSED_RE.exec(text);
        return { kind: "closed", message: m ? m[0] : "Posting not found" };
      }
      // A posting page with an Apply link/button rather than an inline form.
      const apply = page.locator("a, button").filter({ hasText: /^\s*apply( for this job| now| here)?\s*$/i });
      if ((await apply.count()) > 0) {
        await apply.first().click({ timeout: 5000 });
        await page.waitForLoadState("domcontentloaded").catch(() => undefined);
        await page.locator(FORM_SEL).first().waitFor({ timeout: 8000 }).catch(() => undefined);
      }
      if (!(await hasForm(page))) {
        const t = await bodyText(page);
        return { kind: "closed", message: CLOSED_RE.exec(t)?.[0] ?? "No application form found on the page" };
      }
    }
    if (await hasCaptcha(page)) return { kind: "blocked", reason: "captcha", message: "A CAPTCHA is present in the application form" };
    return { kind: "form" };
  },

  async extractForm(page): Promise<FormField[]> {
    const raw = await extractRaw(page);
    const out: FormField[] = [];
    for (const r of raw) {
      const { needsOpen, listboxId, ...field } = r;
      if (needsOpen) {
        const options = await readComboboxOptions(page, r);
        if (options.length > 0) field.options = options;
      }
      void listboxId;
      out.push(field);
    }
    return out;
  },

  async fill(page, answers: Map<string, FieldAnswer>): Promise<void> {
    for (const [id, answer] of answers) {
      await fillField(page, id, answer);
      const value = answer.kind === "option" ? (answer.values[0] ?? "") : answer.kind === "text" ? answer.value : answer.kind === "boolean" ? (answer.value ? "Yes" : "No") : "";
      if (answer.kind !== "file") await waitForDependents(page, await postedNames(page, id), value);
      await sleep(40);
    }
  },

  async submit(page): Promise<SubmitOutcome> {
    const root = page.locator("#application-form").first();
    const scope = (await root.count()) > 0 ? root : page.locator("form").first();
    let btn = scope.locator("button[type=submit], input[type=submit]").first();
    if ((await btn.count()) === 0) btn = page.getByRole("button", { name: /submit/i }).first();
    if ((await btn.count()) === 0) return { ok: false, reason: "error", message: "No submit button found" };

    const response = page.waitForResponse((r) => r.request().method() === "POST", { timeout: 20_000 }).catch(() => null);
    await btn.click({ timeout: 10_000 });
    const resp = await response;
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);

    const deadline = Date.now() + 10_000;
    for (;;) {
      if (await this.confirmSubmitted(page)) return { ok: true };
      const errors = await safe(page, () => alertMessages(page), []);
      if (errors.length > 0) return { ok: false, reason: "validation_error", message: errors.join("; ") };
      const text = await safe(page, () => bodyText(page), "");
      if (resp && resp.status() >= 500) return { ok: false, reason: "error", message: ERROR_RE.exec(text)?.[0] ?? `Server responded ${resp.status()}` };
      if (ERROR_RE.test(text)) return { ok: false, reason: "error", message: ERROR_RE.exec(text)![0] };
      if (await safe(page, () => hasCaptcha(page), false)) return { ok: false, reason: "captcha", message: "A CAPTCHA appeared after submitting" };
      if (Date.now() > deadline) return { ok: false, reason: "error", message: "No confirmation or error appeared after submitting" };
      await sleep(250);
    }
  },

  async confirmSubmitted(page): Promise<boolean> {
    return safe(
      page,
      async () => {
        if ((await page.locator("[data-testid=submission-id]").count()) > 0) return true;
        return CONFIRM_RE.test(await bodyText(page));
      },
      false,
    );
  },
};

import type { Page } from "playwright";

import { fetchBoard } from "../discovery/ashby.ts";
import type { AtsAdapter, FieldAnswer, FormField, PageState, SubmitOutcome } from "../types.ts";
import { closedMessage, currentStep, extractAshbyFields, fillAshbyField, gotoStep, hasCaptcha, hasNext } from "./ashby-dom.ts";

const NAV_TIMEOUT = 30_000;

async function onForm(page: Page): Promise<boolean> {
  return (await page.locator("form input:not([type=hidden]), form textarea").count()) > 0;
}

async function openApplicationTab(page: Page): Promise<void> {
  const link = page
    .locator("a[href$='/application'], a[href*='/application?']")
    .or(page.getByRole("tab", { name: /^application$/i }))
    .or(page.getByRole("link", { name: /^application$/i }))
    .first();
  if ((await link.count()) === 0) return;
  const href = await link.getAttribute("href");
  if (href && !href.startsWith("#")) {
    await page.goto(new URL(href, page.url()).toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  } else {
    await link.click();
  }
}

export const ashbyAdapter: AtsAdapter = {
  kind: "ashby",

  discover: (board) => fetchBoard(board),

  async open(page, applyUrl): Promise<PageState> {
    const resp = await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    const check = async (status: number | undefined): Promise<PageState | null> => {
      if (status === 404 || status === 410) return { kind: "closed", message: (await closedMessage(page)) ?? "Job not found" };
      const closed = await closedMessage(page);
      if (closed) return { kind: "closed", message: closed };
      if (await hasCaptcha(page)) return { kind: "blocked", reason: "captcha", message: "A CAPTCHA is on the application form" };
      return null;
    };
    const first = await check(resp?.status());
    if (first) return first;
    if (!(await onForm(page))) {
      await openApplicationTab(page);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForSelector("form input, form textarea", { timeout: 10_000 }).catch(() => undefined);
      const second = await check(undefined);
      if (second) return second;
    }
    if (!(await onForm(page))) return { kind: "closed", message: "No application form found on the page" };
    return { kind: "form" };
  },

  extractForm: (page): Promise<FormField[]> => extractAshbyFields(page),

  async fill(page: Page, answers: Map<string, FieldAnswer>): Promise<void> {
    const pending = new Map(answers);
    for (let round = 0; round < 3 && pending.size > 0; round++) {
      const fields = await extractAshbyFields(page);
      const todo = fields.filter((f) => pending.has(f.id));
      if (todo.length === 0) break;
      const steps = [...new Set(todo.map((f) => f.page ?? -1))].sort((a, b) => a - b);
      for (const step of steps) {
        if (step >= 0) await gotoStep(page, step);
        for (const f of todo.filter((t) => (t.page ?? -1) === step)) {
          await fillAshbyField(page, f, pending.get(f.id)!);
          pending.delete(f.id);
        }
      }
    }
    if (pending.size > 0) {
      throw new Error(`Ashby: no matching field on the form for: ${[...pending.keys()].join(", ")}`);
    }
  },

  async submit(page: Page): Promise<SubmitOutcome> {
    // Advance to the last step.
    for (let i = 0; i < 10 && (await hasNext(page)); i++) {
      const cur = await currentStep(page);
      if (cur < 0) break;
      try {
        await gotoStep(page, cur + 1);
      } catch (e) {
        return { ok: false, reason: "validation_error", message: e instanceof Error ? e.message : String(e) };
      }
    }
    if (await hasCaptcha(page)) return { ok: false, reason: "captcha", message: "A CAPTCHA must be solved by the user" };

    const button = page.getByRole("button", { name: /submit application/i }).first();
    if ((await button.count()) === 0) return { ok: false, reason: "error", message: "No Submit Application button found" };
    const posted = page
      .waitForResponse((r) => r.request().method() === "POST" && r.request().isNavigationRequest(), { timeout: 20_000 })
      .catch(() => null);
    await button.click();
    const resp = await posted;
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);

    if (resp && resp.status() >= 500) return { ok: false, reason: "error", message: `Server error ${resp.status()} on submit` };
    if (await ashbyAdapter.confirmSubmitted(page)) return { ok: true };
    if (await hasCaptcha(page)) return { ok: false, reason: "captcha", message: "A CAPTCHA appeared after submitting" };

    const alerts = page.locator("[role=alert]:visible");
    const n = await alerts.count();
    const texts: string[] = [];
    for (let i = 0; i < n; i++) texts.push(((await alerts.nth(i).innerText()) ?? "").replace(/\s+/g, " ").trim());
    const message = texts.filter(Boolean).join("; ");
    if (/spam|captcha/i.test(message)) return { ok: false, reason: "captcha", message };
    if (message) return { ok: false, reason: "validation_error", message };
    return { ok: false, reason: "error", message: `Submit did not confirm${resp ? ` (HTTP ${resp.status()})` : ""}` };
  },

  async confirmSubmitted(page: Page): Promise<boolean> {
    if ((await page.locator("[data-testid=submission-id]").count()) > 0) return true;
    const text = ((await page.locator("body").innerText().catch(() => "")) ?? "").toLowerCase();
    return text.includes("successfully submitted");
  },
};

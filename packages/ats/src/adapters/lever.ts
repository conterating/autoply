import type { Page } from "playwright";

import { fetchBoard } from "../discovery/lever.ts";
import type { AtsAdapter, FieldAnswer, FormField, NormalizedPosting, PageState, SubmitOutcome } from "../types.ts";
import { extractLeverFields, fillLeverField } from "./lever-dom.ts";

const CAPTCHA_SELECTOR = ".h-captcha, iframe[title*='captcha' i], .g-recaptcha, iframe[src*='hcaptcha'], iframe[src*='recaptcha']";
const CAPTCHA_MESSAGE = "This application has a CAPTCHA. Open the browser window to finish it.";
const FORM_SELECTOR = "form#application-form, form[action*='/apply'], #btn-submit";

async function hasCaptcha(page: Page): Promise<boolean> {
  return (await page.locator(CAPTCHA_SELECTOR).count()) > 0;
}

async function bodyText(page: Page): Promise<string> {
  return (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).replace(/\s+/g, " ");
}

async function isClosed(page: Page, status: number | null): Promise<string | null> {
  const text = await bodyText(page);
  if (/this posting is closed|no longer accepting applications|job (posting )?(is )?no longer (available|open)/i.test(text)) {
    return "This posting is closed";
  }
  if (status === 404) return "This posting could not be found (404)";
  return null;
}

async function open(page: Page, applyUrl: string): Promise<PageState> {
  const resp = await page.goto(applyUrl, { waitUntil: "domcontentloaded" });
  let status = resp?.status() ?? null;
  let closed = await isClosed(page, status);
  if (closed) return { kind: "closed", message: closed };

  if ((await page.locator(FORM_SELECTOR).count()) === 0) {
    // A posting page: follow "Apply for this job".
    const link = page.locator("a.postings-btn, a[href$='/apply'], a:has-text('Apply for this job')").first();
    if ((await link.count()) === 0) return { kind: "closed", message: "No application form found on this page" };
    const href = await link.getAttribute("href");
    const target = href ? new URL(href, page.url()).toString() : null;
    const next = target ? await page.goto(target, { waitUntil: "domcontentloaded" }) : (await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), link.click()]))[0];
    status = next?.status() ?? null;
    closed = await isClosed(page, status);
    if (closed) return { kind: "closed", message: closed };
  }

  if (await hasCaptcha(page)) return { kind: "blocked", reason: "captcha", message: CAPTCHA_MESSAGE };
  if ((await page.locator("input[name=resume], input[type=file], input[name=name], input[name=email]").count()) === 0) {
    return { kind: "closed", message: "No application form found on this page" };
  }
  return { kind: "form" };
}

async function confirmSubmitted(page: Page): Promise<boolean> {
  if ((await page.locator("[data-testid=submission-id]").count()) > 0) return true;
  return /application submitted|thanks for applying|thank you for (your )?appl/i.test(await bodyText(page));
}

async function submit(page: Page): Promise<SubmitOutcome> {
  const button = page.locator("#btn-submit, button[type=submit], input[type=submit]").first();
  if ((await button.count()) === 0) return { ok: false, reason: "error", message: "Could not find the submit button" };
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.request().resourceType() === "document", { timeout: 30_000 }).catch(() => null),
    button.click(),
  ]);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  if (resp && resp.status() >= 500) return { ok: false, reason: "error", message: `The site returned an error (HTTP ${resp.status()})` };
  if (await confirmSubmitted(page)) return { ok: true };

  const errors = (await page.locator("[role=alert] li, [role=alert]:not(:has(li))").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  const text = await bodyText(page);
  if (errors.some((e) => /captcha/i.test(e)) || /complete the captcha|verify you are human/i.test(text) || (await hasCaptcha(page))) {
    return { ok: false, reason: "captcha", message: CAPTCHA_MESSAGE };
  }
  if (errors.length > 0) return { ok: false, reason: "validation_error", message: errors.join("; ") };
  return { ok: false, reason: "error", message: "Submitting did not lead to a confirmation page" };
}

export const leverAdapter: AtsAdapter = {
  kind: "lever",
  discover: (board): Promise<NormalizedPosting[]> => fetchBoard(board),
  open,
  extractForm: (page: Page): Promise<FormField[]> => extractLeverFields(page),
  async fill(page: Page, answers: Map<string, FieldAnswer>): Promise<void> {
    for (const [id, answer] of answers) await fillLeverField(page, id, answer);
  },
  submit,
  confirmSubmitted,
};

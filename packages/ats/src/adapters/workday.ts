import { randomBytes } from "node:crypto";
import type { Page } from "playwright";

import { getSecret, setSecret } from "@autoply/core/secrets";

import type { AtsAdapter, FieldAnswer, FormField, PageState, SubmitOutcome } from "../types.ts";
import {
  WORKDAY_SELECTORS as SEL,
  clickAndSettle,
  closedMessage,
  currentPage,
  detectView,
  fillField,
  hasCaptcha,
  nextButton,
  readDropdownOptions,
  readErrors,
  scanFields,
  settle,
  submitButton,
} from "./workday-dom.ts";

const NAV_TIMEOUT = 30_000;
/** Posting → Apply → Apply Manually → sign in / create account is at most a handful of hops. */
const MAX_OPEN_STEPS = 8;
/** My Information … Review is six pages; leave headroom for tenants with more. */
const MAX_PAGES = 16;

export type WorkdayCredentials = {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
};

export type WorkdayAdapterOptions = {
  /** Where account passwords live. Defaults to the OS keychain via `@autoply/core/secrets`. */
  credentials?: WorkdayCredentials;
  /** The profile email used as the Workday account login. */
  email?: () => string | null | undefined | Promise<string | null | undefined>;
};

/** Keychain account name for a Workday tenant, e.g. `workday:woodgrove.wd5.myworkdayjobs.com`. */
export function workdayCredentialKey(tenantHost: string): string {
  return `workday:${tenantHost.toLowerCase()}`;
}

/**
 * The tenant an apply URL belongs to. Real tenants are `<tenant>.wdN.myworkdayjobs.com`
 * (one candidate account per tenant host); the fixture replica is `host/workday/<tenant>`.
 */
export function workdayTenantHost(applyUrl: string): string {
  const u = new URL(applyUrl);
  if (u.hostname.endsWith(".myworkdayjobs.com") || u.hostname.endsWith(".myworkdaysite.com")) return u.hostname;
  const m = /^\/workday\/([^/]+)/.exec(u.pathname);
  return m ? `${u.host}/workday/${m[1]}` : u.host;
}

const defaultCredentials: WorkdayCredentials = { get: (key) => getSecret(key), set: (key, value) => setSecret(key, value) };

/** A strong random password that satisfies typical Workday rules (upper, lower, digit, symbol). */
export function generateWorkdayPassword(): string {
  for (;;) {
    const core = randomBytes(18).toString("base64url").replace(/[-_]/g, "");
    if (/[a-z]/.test(core) && /[A-Z]/.test(core) && /\d/.test(core)) {
      const symbols = "!#$%&*+?@^";
      return `${core}${symbols[randomBytes(1)[0]! % symbols.length]}`;
    }
  }
}

/** Visited pages' fields, so the second `extractForm` call returns every page filled so far. */
const visited = new WeakMap<Page, Map<number, FormField[]>>();

async function extractCurrentPage(page: Page): Promise<FormField[]> {
  const info = await currentPage(page);
  const raw = await scanFields(page);
  const fields: FormField[] = [];
  for (const f of raw) {
    const field: FormField = { id: f.id, label: f.label, type: f.type, required: f.required, page: info.index };
    if (f.type === "radio") field.options = f.options;
    if (f.type === "select") field.options = await readDropdownOptions(page, f.id);
    fields.push(field);
  }
  return fields;
}

function collect(page: Page): FormField[] {
  const pages = visited.get(page);
  if (!pages) return [];
  return [...pages.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, f]) => f);
}

function pageErrorMessage(title: string, errors: string[]): string {
  return `Workday rejected the "${title}" page: ${errors.join("; ")}`;
}

export function createWorkdayAdapter(opts: WorkdayAdapterOptions = {}): AtsAdapter {
  const credentials = opts.credentials ?? defaultCredentials;
  const emailOf = opts.email ?? (() => process.env.AUTOPLY_PROFILE_EMAIL);

  async function signIn(page: Page, email: string, key: string, password: string): Promise<PageState | null> {
    if ((await detectView(page)) === "create") await clickAndSettle(page, page.locator(SEL.signInLink).first());
    await page.locator('[data-automation-id="email"]').first().fill(email);
    await page.locator('[data-automation-id="password"]').first().fill(password);
    await clickAndSettle(page, page.locator(SEL.signInSubmit).first());
    const view = await settle(page);
    if (view === "verify") return verification(email);
    if (view === "signin") {
      const errors = await readErrors(page);
      return {
        kind: "blocked",
        reason: "login",
        message: `Workday rejected the saved password for ${email} (${errors[0] ?? "sign-in failed"}). Sign in once yourself, reset the password if needed, and update it in Autoply's keychain entry "${key}".`,
      };
    }
    return null;
  }

  async function createAccount(page: Page, email: string, key: string): Promise<PageState | null> {
    if ((await detectView(page)) === "signin") await clickAndSettle(page, page.locator(SEL.createLink).first());
    const password = generateWorkdayPassword();
    // Store the password BEFORE submitting: if we crash after Workday creates the account, it isn't lost.
    await credentials.set(key, password);
    await page.locator('[data-automation-id="email"]').first().fill(email);
    await page.locator('[data-automation-id="password"]').first().fill(password);
    await page.locator('[data-automation-id="verifyPassword"]').first().fill(password);
    await page.locator('[data-automation-id="createAccountCheckbox"]').first().setChecked(true, { force: true });
    await clickAndSettle(page, page.locator(SEL.createSubmit).first());
    const view = await settle(page);
    if (view === "verify") return verification(email);
    if (view === "create") {
      const errors = await readErrors(page);
      return {
        kind: "blocked",
        reason: "login",
        message: `Workday wouldn't create an account for ${email}: ${errors.join(" ") || "unknown error"}. If an account already exists, sign in once yourself and save its password under the keychain entry "${key}".`,
      };
    }
    return null;
  }

  function verification(email: string): PageState {
    return {
      kind: "blocked",
      reason: "verification",
      message: `Workday sent a verification email to ${email}. Open the link in that email, then run this application again.`,
    };
  }

  async function authenticate(page: Page, applyUrl: string): Promise<PageState | null> {
    const email = (await emailOf())?.trim();
    if (!email) {
      return { kind: "blocked", reason: "login", message: "Workday needs an account, but your profile has no email address to create one with." };
    }
    const key = workdayCredentialKey(workdayTenantHost(applyUrl));
    const stored = await credentials.get(key);
    return stored ? signIn(page, email, key, stored) : createAccount(page, email, key);
  }

  return {
    kind: "workday",

    // Workday has no public JSON board; postings come from community lists.
    discover: async () => [],

    async open(page, applyUrl): Promise<PageState> {
      const resp = await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      if (resp?.status() === 404 || resp?.status() === 410) {
        return { kind: "closed", message: (await closedMessage(page)) ?? "This job posting is no longer available" };
      }
      visited.delete(page);
      for (let step = 0; step < MAX_OPEN_STEPS; step++) {
        const view = await settle(page);
        const closed = await closedMessage(page);
        if (closed && view === "unknown") return { kind: "closed", message: closed };
        if (await hasCaptcha(page)) return { kind: "blocked", reason: "captcha", message: "Workday is showing a CAPTCHA. Finish it yourself." };
        switch (view) {
          case "application":
            return { kind: "form" };
          case "posting":
            await clickAndSettle(page, page.locator(SEL.apply).first());
            break;
          case "choice":
            await clickAndSettle(page, page.locator(SEL.applyManually).first());
            break;
          case "signin":
          case "create": {
            const blocked = await authenticate(page, applyUrl);
            if (blocked) return blocked;
            break;
          }
          case "verify": {
            const email = (await emailOf())?.trim() ?? "your email address";
            return verification(email);
          }
          case "submitted":
            return { kind: "closed", message: "Workday shows this application was already submitted" };
          default:
            return closed ? { kind: "closed", message: closed } : { kind: "closed", message: "No Workday application found at this address" };
        }
      }
      return { kind: "closed", message: "Couldn't reach the Workday application form" };
    },

    async extractForm(page): Promise<FormField[]> {
      if ((await detectView(page)) !== "application") return collect(page);
      const info = await currentPage(page);
      if (!info.review) {
        const fields = await extractCurrentPage(page);
        const pages = visited.get(page) ?? new Map<number, FormField[]>();
        pages.set(info.index, fields);
        visited.set(page, pages);
      }
      return collect(page);
    },

    /**
     * Fills the current page from `answers`, clicks Save and Continue, and repeats
     * until the Review page. Stops (without error) at a page whose required fields
     * have no answer yet: the worker extracts it, resolves it, and calls fill again.
     */
    async fill(page: Page, answers: Map<string, FieldAnswer>): Promise<void> {
      for (let i = 0; i < MAX_PAGES; i++) {
        if ((await detectView(page)) !== "application") return;
        const info = await currentPage(page);
        if (info.review) return;
        for (const f of await scanFields(page)) {
          const answer = answers.get(f.id);
          if (answer) await fillField(page, f, answer);
        }
        const unanswered = (await scanFields(page)).filter((f) => f.required && !f.filled);
        if (unanswered.length > 0) return;

        await clickAndSettle(page, nextButton(page));
        const errors = await readErrors(page);
        if (errors.length > 0) throw new Error(pageErrorMessage(info.title, errors));
        const after = await currentPage(page);
        if (after.index === info.index && after.title === info.title && !after.review) {
          throw new Error(`Workday stayed on the "${info.title}" page after Save and Continue`);
        }
      }
      throw new Error("Workday application has more pages than expected");
    },

    async submit(page: Page): Promise<SubmitOutcome> {
      if (await hasCaptcha(page)) return { ok: false, reason: "captcha", message: "Workday is showing a CAPTCHA before submit" };
      const view = await detectView(page);
      if (view === "submitted") return { ok: true };
      if (view !== "application") return { ok: false, reason: "error", message: "The Workday application isn't open" };
      const info = await currentPage(page);
      if (!info.review) {
        return { ok: false, reason: "error", message: `The Workday application is on "${info.title}", not the Review page; some questions are unanswered` };
      }
      await clickAndSettle(page, submitButton(page));
      const after = await settle(page);
      if (after === "submitted") return { ok: true };
      if (await hasCaptcha(page)) return { ok: false, reason: "captcha", message: "Workday is showing a CAPTCHA" };
      const errors = await readErrors(page);
      if (errors.length > 0) return { ok: false, reason: "validation_error", message: pageErrorMessage("Review", errors) };
      const bannerText = await page.locator('[data-automation-id="errorBanner"]').first().innerText().catch(() => "");
      if (bannerText) return { ok: false, reason: "validation_error", message: `Workday rejected the application: ${bannerText.replace(/\s+/g, " ").trim()}` };
      return { ok: false, reason: "error", message: "Workday didn't show an \"Application Submitted\" confirmation" };
    },

    async confirmSubmitted(page: Page): Promise<boolean> {
      if ((await page.locator(SEL.submitted).count()) > 0) return true;
      return page
        .getByText(/application submitted/i)
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .then(() => true)
        .catch(() => false);
    },
  };
}

export const workdayAdapter: AtsAdapter = createWorkdayAdapter();

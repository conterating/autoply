import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ProfileSchema, type FieldAnswer, type FormField, type Profile, type ProfileInput } from "@autoply/core";
import { resolveForm, type Resolution } from "@autoply/core/resolver";

import { FIXTURE_BOARDS, startFixtureServer, type FixtureServer } from "../../../../tests/fixtures/ats/src/index.ts";
import { workdayPostingPath } from "../../../../tests/fixtures/ats/src/workday.ts";
import { createWorkdayAdapter, generateWorkdayPassword, workdayCredentialKey, workdayTenantHost, type WorkdayCredentials } from "../../src/adapters/workday.ts";

const RESUME = resolve(import.meta.dirname, "../../../../tests/fixtures/resumes/sample-resume.pdf");
const EMAIL = "jordan.rivera@example.com";
const wd = FIXTURE_BOARDS.workday;
const [PLAIN, SECOND, VERIFY, CLOSED] = wd.postings as [(typeof wd.postings)[number], (typeof wd.postings)[number], (typeof wd.postings)[number], (typeof wd.postings)[number]];

const c = <T>(value: T) => ({ value, confirmedByUser: true });

function profile(): Profile {
  return ProfileSchema.parse({
    version: 1,
    identity: {
      legalFirstName: c("Jordan"),
      legalLastName: c("Rivera"),
      email: c(EMAIL),
      phoneCountryCode: c("+1"),
      phoneNumber: c("5125550142"),
      addressLine1: c("500 Congress Ave"),
      city: c("Austin"),
      state: c("TX"),
      postalCode: c("78701"),
      country: c("United States"),
    },
    links: { linkedin: c("https://www.linkedin.com/in/jordanrivera") },
    workAuthorization: {
      authorizedCountries: c([{ country: "US", authorized: true }]),
      requiresSponsorshipNow: c(false),
      requiresSponsorshipFuture: c(false),
      visaType: c("U.S. Citizen"),
      citizenship: c(["US"]),
      securityClearance: c("none"),
    },
    eeo: {
      gender: c("decline"),
      raceEthnicity: c(["decline"]),
      hispanicLatino: c("decline"),
      veteranStatus: c("not_protected_veteran"),
      disabilityStatus: c("no"),
      sexualOrientation: c("decline"),
      transgender: c("decline"),
    },
    screening: { howDidYouHear: c("Company Website"), previousEmployers: c([]), acceptAttestations: c(true) },
  } as ProfileInput);
}

/** Answers for fields the resolver can't (yet) answer from the profile: these are resolver gaps. */
const FIXED: Record<string, FieldAnswer> = {
  "phone--deviceType": { kind: "option", values: ["Mobile"] },
  "q--whyInterested": { kind: "text", value: "I enjoy building reliable payment systems." },
  "selfIdentifiedDisabilityData--dateSignedOn": { kind: "text", value: "11/23/2026" },
  "address--countryRegion": { kind: "option", values: ["Texas"] },
};

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const calls = { get: [] as string[], set: [] as string[] };
  const store: WorkdayCredentials = {
    get: (key) => {
      calls.get.push(key);
      return data.get(key) ?? null;
    },
    set: (key, value) => {
      calls.set.push(key);
      data.set(key, value);
    },
  };
  return { store, data, calls };
}

let browser: Browser;
let srv: FixtureServer;
let ctx: BrowserContext;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  srv = await startFixtureServer({ port: 0 });
});
afterAll(async () => {
  await browser.close();
  await srv.close();
});
beforeEach(async () => {
  srv.reset();
  ctx = await browser.newContext();
  page = await ctx.newPage();
});

const url = (p: (typeof wd.postings)[number]) => srv.url + workdayPostingPath(p);
const adapterWith = (store: WorkdayCredentials) => createWorkdayAdapter({ credentials: store, email: () => EMAIL });
const KEY = () => workdayCredentialKey(workdayTenantHost(url(PLAIN)));

type Gap = { id: string; label: string; status: Resolution["status"]; reason: string };

/** Runs the worker's prepare loop (extract → resolve → fill → re-extract) until no new fields appear. */
async function prepare(adapter: ReturnType<typeof createWorkdayAdapter>, p: Page, prof: Profile) {
  const ctxResolve = {
    profile: prof,
    company: wd.company,
    today: new Date("2026-11-23T12:00:00Z"),
    threshold: 0.85,
    llm: null,
    findBankAnswer: () => null,
    documents: { resume: { path: RESUME, filename: "sample-resume.pdf" } },
  };
  const gaps: Gap[] = [];
  const answers = new Map<string, FieldAnswer>();
  const resolveNew = async (fields: FormField[]) => {
    for (const r of await resolveForm(fields, ctxResolve)) {
      if (r.status === "answered" && r.answer) answers.set(r.fieldId, r.answer);
      else {
        gaps.push({ id: r.fieldId, label: r.label, status: r.status, reason: r.reason });
        const fixed = FIXED[r.fieldId];
        if (!fixed) throw new Error(`No fixed answer for ${r.fieldId} "${r.label}" (${r.status}: ${r.reason})`);
        answers.set(r.fieldId, fixed);
      }
    }
  };
  let fields = await adapter.extractForm(p);
  await resolveNew(fields);
  for (let round = 0; round < 10; round++) {
    await adapter.fill(p, answers);
    const after = await adapter.extractForm(p);
    const known = new Set(fields.map((f) => f.id));
    const added = after.filter((f) => !known.has(f.id));
    if (!added.length) break;
    fields = [...fields, ...added];
    await resolveNew(added);
  }
  return { fields, answers, gaps };
}

function expectedFields(prof: Profile): Record<string, string> {
  const id = prof.identity;
  return {
    "account--email": id.email.value!,
    "source--source": prof.screening.howDidYouHear.value!,
    candidateIsPreviousWorker: "No",
    "legalName--firstName": id.legalFirstName.value!,
    "legalName--lastName": id.legalLastName.value!,
    "address--addressLine1": id.addressLine1.value!,
    "address--city": id.city.value!,
    "address--countryRegion": "Texas",
    "address--postalCode": id.postalCode.value!,
    "phone--deviceType": "Mobile",
    "phone--phoneNumber": id.phoneNumber.value!,
    linkedInAccount: prof.links.linkedin.value!,
    "q--workAuthorization": "Yes",
    "q--sponsorship": "No",
    "q--whyInterested": "I enjoy building reliable payment systems.",
    "voluntary--gender": "I do not wish to self-identify",
    "voluntary--ethnicity": "I do not wish to answer",
    "voluntary--veteranStatus": "I am not a protected veteran",
    "termsAndConditions--acceptTermsAndAgreements": "true",
    "selfIdentifiedDisabilityData--name": `${id.legalFirstName.value} ${id.legalLastName.value}`,
    "selfIdentifiedDisabilityData--dateSignedOn": "11/23/2026",
    "selfIdentifiedDisabilityData--disabilityStatus": "No, I do not have a disability and have not had one in the past",
  };
}

describe("workday credentials", () => {
  it("derives the keychain key from the tenant", () => {
    expect(workdayCredentialKey("woodgrove.wd5.myworkdayjobs.com")).toBe("workday:woodgrove.wd5.myworkdayjobs.com");
    expect(workdayTenantHost("https://woodgrove.wd5.myworkdayjobs.com/en-US/External/job/Austin-TX/Eng_R-1")).toBe("woodgrove.wd5.myworkdayjobs.com");
    expect(workdayTenantHost("http://127.0.0.1:4399/workday/woodgrove/External/job/x/y_R-1")).toBe("127.0.0.1:4399/workday/woodgrove");
  });

  it("generates strong, distinct passwords", () => {
    const a = generateWorkdayPassword();
    expect(a).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16,}$/);
    expect(generateWorkdayPassword()).not.toBe(a);
  });
});

describe("workday adapter", () => {
  it("opens a posting, creates an account and stores the generated password first", async () => {
    const { store, data, calls } = memoryStore();
    const adapter = adapterWith(store);
    const state = await adapter.open(page, url(PLAIN));
    expect(state).toEqual({ kind: "form" });
    expect(page.url()).toContain("/apply/R-10231/myInformation");
    expect(calls.set).toEqual([KEY()]);
    const password = data.get(KEY())!;
    expect(password.length).toBeGreaterThanOrEqual(16);

    // The stored password is the real one: signing in with it works in a fresh browser.
    const other = await (await browser.newContext()).newPage();
    expect(await adapterWith(store).open(other, url(SECOND))).toEqual({ kind: "form" });
    expect(calls.set).toEqual([KEY()]);
    await other.context().close();
  });

  it("extracts My Information (types, labels, options, required) and accumulates pages as it fills", async () => {
    const adapter = adapterWith(memoryStore().store);
    await adapter.open(page, url(PLAIN));
    const first = await adapter.extractForm(page);
    expect(first.every((f) => f.page === 0)).toBe(true);
    const byLabel = (l: string) => first.find((f) => f.label === l)!;
    expect(first.map((f) => f.label)).toEqual([
      "How Did You Hear About Us?",
      "Have you previously worked for Woodgrove Bank?",
      "Given Name(s)",
      "Family Name",
      "Address Line 1",
      "City",
      "State",
      "Postal Code",
      "Phone Device Type",
      "Phone Number",
    ]);
    expect(byLabel("How Did You Hear About Us?")).toMatchObject({ id: "source--source", type: "select", required: true });
    expect(byLabel("How Did You Hear About Us?").options?.map((o) => o.label)).toContain("Company Website");
    expect(byLabel("State").options).toHaveLength(51);
    expect(byLabel("Have you previously worked for Woodgrove Bank?")).toMatchObject({ type: "radio", options: [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }] });
    expect(byLabel("Phone Number")).toMatchObject({ type: "tel", required: true });
    // Extraction doesn't select anything and closes every listbox.
    expect(await page.locator('[role="listbox"]').count()).toBe(0);
    expect(await adapter.extractForm(page)).toHaveLength(first.length);

    // A fill with no answers must not advance or throw.
    await adapter.fill(page, new Map());
    expect(page.url()).toContain("myInformation");

    const prof = profile();
    const { fields } = await prepare(adapter, page, prof);
    expect(new Set(fields.map((f) => f.page))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(fields.find((f) => f.label === "Resume/CV")).toMatchObject({ id: "resume", type: "file", page: 1, required: true });
    expect(fields.find((f) => f.label === "I have read and consent to the terms and conditions.")).toMatchObject({ type: "checkbox", page: 3 });
    expect(fields.find((f) => f.label === "Disability Status")).toMatchObject({ type: "radio", page: 4 });
    expect(page.url()).toContain("/review");
  });

  it("end to end with the real resolver: fills every page, submits, records the profile field for field", async () => {
    const { store } = memoryStore();
    const adapter = adapterWith(store);
    const prof = profile();
    expect(await adapter.open(page, url(PLAIN))).toEqual({ kind: "form" });
    const { gaps, answers } = await prepare(adapter, page, prof);

    // Fields the resolver could not answer; the test supplied FIXED answers (resolver gaps for the lead).
    console.info("workday resolver gaps:", JSON.stringify(gaps.map((g) => ({ id: g.id, label: g.label, status: g.status, reason: g.reason })), null, 1));
    expect(gaps.map((g) => g.id).sort()).toEqual(expect.arrayContaining(["phone--deviceType"]));

    expect(await adapter.submit(page)).toEqual({ ok: true });
    expect(await adapter.confirmSubmitted(page)).toBe(true);
    expect(await page.locator('[data-testid="submission-id"]').innerText()).toBe("FX-0001");

    const subs = srv.submissions();
    expect(subs).toHaveLength(1);
    const sub = subs[0]!;
    expect(sub).toMatchObject({ ats: "workday", board: "woodgrove", jobId: PLAIN.id });
    expect(sub.fields).toEqual(expectedFields(prof));
    expect(Object.keys(sub.files)).toEqual(["resume"]);
    expect(sub.files.resume).toMatchObject({ filename: "sample-resume.pdf", size: statSync(RESUME).size });
    expect(readFileSync(RESUME).length).toBe(sub.files.resume!.size);
    expect(answers.get("resume")).toMatchObject({ kind: "file" });
  });

  it("a second application signs in with the stored password; submit works from a fresh page like the worker's submit step", async () => {
    const { store, data, calls } = memoryStore();
    const adapter = adapterWith(store);
    const prof = profile();

    await adapter.open(page, url(PLAIN));
    await prepare(adapter, page, prof);
    expect((await adapter.submit(page)).ok).toBe(true);
    const password = data.get(KEY());
    expect(calls.set).toHaveLength(1);

    // New browser context: no cookies, so Workday asks for credentials again and we must sign in.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    expect(await adapter.open(page2, url(SECOND))).toEqual({ kind: "form" });
    expect(calls.set).toHaveLength(1);
    expect(data.get(KEY())).toBe(password);
    expect(calls.get.length).toBeGreaterThanOrEqual(2);

    // Prepare (stops at Review), then redo what submitApplication does: reopen, extract, fill stored answers, submit.
    const { answers } = await prepare(adapter, page2, prof);
    expect(page2.url()).toContain("/review");
    const page3 = await ctx2.newPage();
    expect(await adapter.open(page3, url(SECOND))).toEqual({ kind: "form" });
    const fields = await adapter.extractForm(page3);
    expect(fields.every((f) => f.page === 0)).toBe(true);
    await adapter.fill(page3, answers);
    expect(page3.url()).toContain("/review");
    expect(await adapter.submit(page3)).toEqual({ ok: true });
    expect(await adapter.confirmSubmitted(page3)).toBe(true);
    await ctx2.close();

    const subs = srv.submissions();
    expect(subs.map((s) => s.jobId)).toEqual([PLAIN.id, SECOND.id]);
    expect(subs[1]!.fields).toEqual(expectedFields(prof));
  });

  it("submit refuses to click anything before the Review page", async () => {
    const adapter = adapterWith(memoryStore().store);
    await adapter.open(page, url(PLAIN));
    const out = await adapter.submit(page);
    expect(out).toMatchObject({ ok: false, reason: "error" });
    expect(out.ok === false && out.message).toContain("My Information");
    expect(srv.submissions()).toHaveLength(0);
  });

  it("returns blocked/login with a clear message when the stored password is wrong, without leaking it", async () => {
    // Account exists on the server with a different password than the one stored.
    const a = memoryStore();
    await adapterWith(a.store).open(page, url(PLAIN));
    const wrong = "Wr0ng!StoredPassw0rd";
    const b = memoryStore({ [KEY()]: wrong });
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    const state = await adapterWith(b.store).open(page2, url(PLAIN));
    expect(state).toMatchObject({ kind: "blocked", reason: "login" });
    if (state.kind !== "blocked") throw new Error("unreachable");
    expect(state.message).toContain(EMAIL);
    expect(state.message).toContain(KEY());
    expect(state.message).not.toContain(wrong);
    expect(b.calls.set).toEqual([]);
    await ctx2.close();
  });

  it("returns blocked/login when a site account already exists and no password is stored", async () => {
    await adapterWith(memoryStore().store).open(page, url(PLAIN));
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    const state = await adapterWith(memoryStore().store).open(page2, url(PLAIN));
    expect(state).toMatchObject({ kind: "blocked", reason: "login" });
    expect(state.kind === "blocked" && state.message).toContain("already exists");
    await ctx2.close();
  });

  it("returns blocked/verification when Workday asks for email verification, and recovers after verifying", async () => {
    const { store } = memoryStore();
    const adapter = adapterWith(store);
    const state = await adapter.open(page, url(VERIFY));
    expect(state).toMatchObject({ kind: "blocked", reason: "verification" });
    expect(state.kind === "blocked" && state.message).toContain(EMAIL);

    // Signing in before verifying hits the same wall.
    expect(await adapter.open(page, url(VERIFY))).toMatchObject({ kind: "blocked", reason: "verification" });

    await fetch(`${srv.url}/workday/__verify?email=${encodeURIComponent(EMAIL)}`);
    expect(await adapter.open(page, url(VERIFY))).toEqual({ kind: "form" });
  });

  it("reports a closed posting", async () => {
    const state = await adapterWith(memoryStore().store).open(page, srv.url + workdayPostingPath(CLOSED));
    expect(state.kind).toBe("closed");
  });

  it("blocks without an email instead of creating an account", async () => {
    const adapter = createWorkdayAdapter({ credentials: memoryStore().store, email: () => null });
    expect(await adapter.open(page, url(PLAIN))).toMatchObject({ kind: "blocked", reason: "login" });
  });

  it("discover returns nothing (no public JSON board)", async () => {
    expect(await adapterWith(memoryStore().store).discover({ boardToken: "woodgrove", companyName: "Woodgrove Bank" })).toEqual([]);
  });
});

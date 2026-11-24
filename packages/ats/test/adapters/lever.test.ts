import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ProfileSchema, type Profile } from "../../../core/src/index.ts";
import { resolveForm, type Resolution } from "../../../core/src/resolver/resolve.ts";
import { FIXTURE_BOARDS, startFixtureServer, type FixtureServer } from "../../../../tests/fixtures/ats/src/index.ts";
import { leverAdapter } from "../../src/adapters/lever.ts";
import type { FieldAnswer, FormField } from "../../src/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const RESUME = path.resolve(here, "../../../../tests/fixtures/resumes/sample-resume.pdf");
const board = FIXTURE_BOARDS.lever;
const V = board.variants;
const posting = (id: string) => board.postings.find((p) => p.id === id)!;
const jobId = (n: number) => `c0ffee01-5a1e-4b0b-9a10-00000000000${n}`;

const c = <T>(value: T) => ({ value, confirmedByUser: true });

function profile(opts: { sponsorship: boolean }): Profile {
  return ProfileSchema.parse({
    identity: {
      legalFirstName: c("Jordan"),
      legalLastName: c("Rivera"),
      email: c("jordan.rivera@example.com"),
      phoneCountryCode: c("+1"),
      phoneNumber: c("512-555-0147"),
      city: c("Austin"),
      state: c("TX"),
      country: c("US"),
    },
    links: {
      linkedin: c("https://www.linkedin.com/in/jordanrivera"),
      github: c("https://github.com/jordanrivera"),
      portfolio: c("https://jordanrivera.dev"),
    },
    experience: [{ id: "e1", company: "Northwind Labs", title: "Software Engineer", current: true, startDate: "2023-06", confirmedByUser: true }],
    skills: c(["TypeScript", "Python"]),
    workAuthorization: {
      authorizedCountries: c([{ country: "US", authorized: true }]),
      requiresSponsorshipNow: c(opts.sponsorship),
      requiresSponsorshipFuture: c(opts.sponsorship),
      visaType: c(opts.sponsorship ? "H-1B" : ""),
    },
    eeo: {
      gender: c("decline"),
      raceEthnicity: c(["decline"]),
      hispanicLatino: c("decline"),
      veteranStatus: c("not_protected_veteran"),
      disabilityStatus: c("decline"),
    },
    screening: {
      skillYears: c([
        { skill: "TypeScript", years: 4 },
        { skill: "Python", years: 3 },
      ]),
      acceptAttestations: c(true),
    },
  });
}

const FIXED: Record<string, FieldAnswer> = {
  "Why are you interested in this role?": { kind: "text", value: "I enjoy building reliable developer tools." },
  "Which languages have you used professionally?": { kind: "option", values: ["TypeScript", "Python"] },
  "Additional information": { kind: "text", value: "Happy to share more on request." },
};

async function resolveAnswers(fields: FormField[], p: Profile): Promise<{ answers: Map<string, FieldAnswer>; resolutions: Resolution[] }> {
  const resolutions = await resolveForm(fields, {
    profile: p,
    company: board.company,
    findBankAnswer: () => null,
    llm: null,
    threshold: 0.85,
    documents: { resume: { path: RESUME, filename: "sample-resume.pdf" } },
  });
  const answers = new Map<string, FieldAnswer>();
  for (const r of resolutions) {
    const fixed = FIXED[r.label];
    if (r.status === "answered" && r.answer) answers.set(r.fieldId, r.answer);
    else if (fixed && (r.status === "needs_draft" || r.status === "needs_input" || r.status === "skipped")) answers.set(r.fieldId, fixed);
  }
  return { answers, resolutions };
}

let server: FixtureServer;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
});
beforeEach(async () => {
  server.reset();
  page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(15_000);
});

const hosted = (id: string) => `${server.url}/lever/${board.token}/${id}`;
const byLabel = (fields: FormField[], label: string) => {
  const f = fields.find((x) => x.label === label);
  if (!f) throw new Error(`no field "${label}" in ${fields.map((x) => x.label).join(" | ")}`);
  return f;
};

describe("lever adapter: open", () => {
  it("follows Apply from a posting page to the form", async () => {
    const state = await leverAdapter.open(page, hosted(jobId(1)));
    expect(state).toEqual({ kind: "form" });
    expect(page.url()).toMatch(/\/apply$/);
  });

  it("opens an apply URL directly", async () => {
    expect(await leverAdapter.open(page, `${hosted(jobId(1))}/apply`)).toEqual({ kind: "form" });
  });

  it("reports closed postings", async () => {
    const state = await leverAdapter.open(page, hosted(V.closed));
    expect(state).toMatchObject({ kind: "closed" });
    expect((state as { message: string }).message).toMatch(/closed/i);
  });

  it("reports a captcha up front without touching it", async () => {
    const state = await leverAdapter.open(page, hosted(V.captcha));
    expect(state).toEqual({ kind: "blocked", reason: "captcha", message: "This application has a CAPTCHA. Open the browser window to finish it." });
  });
});

describe("lever adapter: extractForm", () => {
  it("extracts labels, types, required flags and options", async () => {
    await leverAdapter.open(page, hosted(jobId(1)));
    const fields = await leverAdapter.extractForm(page);
    const label = (l: string) => byLabel(fields, l);

    expect(label("Full name")).toMatchObject({ id: "name", type: "text", required: true });
    expect(label("Email")).toMatchObject({ id: "email", type: "email", required: true });
    expect(label("Phone")).toMatchObject({ type: "tel", required: false });
    expect(label("Current location").required).toBe(false);
    expect(label("Current company").id).toBe("org");
    expect(label("LinkedIn URL").id).toBe("urls[LinkedIn]");
    expect(label("Resume/CV")).toMatchObject({ id: "resume", type: "file", required: true });
    expect(label("Additional information")).toMatchObject({ id: "comments", type: "textarea", required: false });
    expect(label("Why are you interested in this role?")).toMatchObject({ type: "text", required: true });
    expect(label("Why are you interested in this role?").id).toMatch(/^cards\[[0-9a-f-]{36}\]\[field0\]$/);

    const auth = label("Are you legally authorized to work in the United States?");
    expect(auth).toMatchObject({ type: "radio", required: true });
    expect(auth.options).toEqual([
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" },
    ]);
    expect(label("Will you require sponsorship?").type).toBe("radio");

    const langs = label("Which languages have you used professionally?");
    expect(langs).toMatchObject({ type: "checkbox", multiple: true, required: false });
    expect(langs.options?.map((o) => o.value)).toEqual(["TypeScript", "Python", "Go", "Java", "Rust"]);

    const gender = label("Gender");
    expect(gender).toMatchObject({ id: "eeo[gender]", type: "select", required: false });
    expect(gender.options?.map((o) => o.label)).toEqual(["Male", "Female", "Decline to self-identify"]);
    expect(label("Race").options).toContainEqual({ value: "Decline to self-identify", label: "Decline to self-identify" });
    expect(label("Veteran status").options?.[0]).toEqual({ value: "I am not a protected veteran", label: "I am not a protected veteran" });
    expect(fields.some((f) => /captcha/i.test(f.id) || /captcha/i.test(f.label))).toBe(false);
    // The conditional visa question is not in this variant at all.
    expect(fields.some((f) => /visa/i.test(f.label))).toBe(false);
  });

  it("skips the hidden, disabled conditional question until it is revealed", async () => {
    await leverAdapter.open(page, hosted(V.conditionalSponsorship));
    const before = await leverAdapter.extractForm(page);
    expect(before.some((f) => /visa/i.test(f.label))).toBe(false);
    await page.getByRole("radiogroup", { name: /sponsorship/i }).getByLabel("Yes").check();
    const after = await leverAdapter.extractForm(page);
    expect(byLabel(after, "What visa type will you need?")).toMatchObject({ type: "text" });
  });
});

describe("lever adapter: end to end with the resolver", () => {
  it("fills and submits a fully confirmed profile, field for field", async () => {
    const p = profile({ sponsorship: false });
    expect(await leverAdapter.open(page, hosted(jobId(1)))).toEqual({ kind: "form" });
    const fields = await leverAdapter.extractForm(page);
    const { answers, resolutions } = await resolveAnswers(fields, p);

    const unresolved = resolutions.filter((r) => r.status === "needs_input").map((r) => r.label);
    expect(unresolved).toEqual([]);
    await leverAdapter.fill(page, answers);

    expect(await leverAdapter.submit(page)).toEqual({ ok: true });
    expect(await leverAdapter.confirmSubmitted(page)).toBe(true);

    const subs = server.submissions();
    expect(subs).toHaveLength(1);
    const sub = subs[0]!;
    const f = sub.fields;
    const cardVal = (n: number) => f[`cards[a1b2c3d4-000${n}-4000-8000-00000000000${n}][field0]`];
    expect(f["name"]).toBe("Jordan Rivera");
    expect(f["email"]).toBe("jordan.rivera@example.com");
    expect(f["phone"]).toBe("512-555-0147");
    expect(f["location"]).toBe("Austin, TX");
    expect(f["org"]).toBe("Northwind Labs");
    expect(f["urls[LinkedIn]"]).toBe("https://www.linkedin.com/in/jordanrivera");
    expect(f["urls[GitHub]"]).toBe("https://github.com/jordanrivera");
    expect(f["urls[Portfolio]"]).toBe("https://jordanrivera.dev");
    expect(cardVal(1)).toBe("Yes");
    expect(cardVal(2)).toBe("No");
    expect(cardVal(3)).toBeUndefined();
    expect(cardVal(4)).toEqual(["TypeScript", "Python"]);
    expect(cardVal(5)).toBe("I enjoy building reliable developer tools.");
    expect(f["comments"]).toBe("Happy to share more on request.");
    expect(f["eeo[gender]"]).toBe("Decline to self-identify");
    expect(f["eeo[race]"]).toBe("Decline to self-identify");
    expect(f["eeo[veteran]"]).toBe("I am not a protected veteran");
    expect(sub.files["resume"]).toMatchObject({ filename: "sample-resume.pdf" });
    expect(sub.files["resume"]!.size).toBeGreaterThan(0);
  });

  it("reveals and fills the conditional visa question for a profile needing sponsorship", async () => {
    const p = profile({ sponsorship: true });
    expect(await leverAdapter.open(page, hosted(V.conditionalSponsorship))).toEqual({ kind: "form" });
    const fields = await leverAdapter.extractForm(page);
    const first = await resolveAnswers(fields, p);
    let answers = first.answers;
    await leverAdapter.fill(page, answers);

    const after = await leverAdapter.extractForm(page);
    const known = new Set(fields.map((x) => x.id));
    const added = after.filter((x) => !known.has(x.id));
    expect(added.map((x) => x.label)).toEqual(["What visa type will you need?"]);
    const second = await resolveAnswers(added, p);
    // The resolver deliberately refuses "What visa type will you need?" (its `not` pattern treats it as a
    // future-visa question), so this lands in Needs Input; production would ask the user, who answers H-1B.
    expect(second.resolutions[0]!.status).toBe("needs_input");
    answers = new Map([...answers, [added[0]!.id, { kind: "text", value: p.workAuthorization.visaType.value! }]]);
    await leverAdapter.fill(page, answers);

    expect(await leverAdapter.submit(page)).toEqual({ ok: true });
    const f = server.submissions()[0]!.fields;
    expect(f["cards[a1b2c3d4-0002-4000-8000-000000000002][field0]"]).toBe("Yes");
    expect(f["cards[a1b2c3d4-0003-4000-8000-000000000003][field0]"]).toBe("H-1B");
  });
});

describe("lever adapter: failures", () => {
  it("returns validation_error when the resume is missing", async () => {
    const p = profile({ sponsorship: false });
    await leverAdapter.open(page, hosted(jobId(1)));
    const fields = await leverAdapter.extractForm(page);
    const { answers } = await resolveAnswers(fields, p);
    answers.delete("resume");
    await leverAdapter.fill(page, answers);
    const out = await leverAdapter.submit(page);
    expect(out).toMatchObject({ ok: false, reason: "validation_error" });
    expect((out as { message: string }).message).toContain("Resume is required");
    expect(server.submissions()).toHaveLength(0);
  });

  it("throws descriptive errors for unknown fields and options", async () => {
    await leverAdapter.open(page, hosted(jobId(1)));
    await expect(leverAdapter.fill(page, new Map([["nope", { kind: "text", value: "x" }]]))).rejects.toThrow(/nope/);
    await expect(leverAdapter.fill(page, new Map([["eeo[gender]", { kind: "option", values: ["Other"] }]]))).rejects.toThrow(/no option "Other"/);
  });

  it("never submits a captcha posting", async () => {
    const id = V.captcha;
    expect(posting(id).variants).toContain("captcha");
    const state = await leverAdapter.open(page, hosted(id));
    expect(state).toMatchObject({ kind: "blocked", reason: "captcha" });
    expect(server.submissions()).toHaveLength(0);
  });

  it("reports captcha if a submit is attempted anyway", async () => {
    await page.goto(`${hosted(V.captcha)}/apply`);
    await page.fill("#name", "Jordan Rivera");
    await page.fill("#email", "jordan.rivera@example.com");
    const out = await leverAdapter.submit(page);
    expect(out).toMatchObject({ ok: false, reason: "captcha" });
    expect(server.submissions()).toHaveLength(0);
  });
});

import { resolve as resolvePath } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ProfileSchema, type Profile, type ProfileInput } from "../../../core/src/profile/schema.ts";
import { resolveForm, type Resolution, type ResolveContext } from "../../../core/src/resolver/resolve.ts";
import type { FieldAnswer, FormField } from "../../../core/src/resolver/types.ts";
import { startFixtureServer, type FixtureServer } from "../../../../tests/fixtures/ats/src/index.ts";
import { greenhouseAdapter as gh } from "../../src/adapters/greenhouse.ts";

const T = { timeout: 60_000 };
const RESUME = resolvePath(__dirname, "../../../../tests/fixtures/resumes/sample-resume.pdf");
const c = <V>(value: V) => ({ value, confirmedByUser: true });

function profile(sponsorship = false): Profile {
  const input = {
    version: 1,
    identity: {
      legalFirstName: c("Jordan"),
      legalMiddleName: c(""),
      legalLastName: c("Rivera"),
      preferredName: c("Jordan"),
      pronouns: c(""),
      email: c("jordan.rivera@example.com"),
      phoneCountryCode: c("+1"),
      phoneNumber: c("5550142020"),
      addressLine1: c("100 Market St"),
      addressLine2: c(""),
      city: c("San Francisco"),
      state: c("CA"),
      postalCode: c("94105"),
      country: c("United States"),
    },
    links: {
      linkedin: c("https://linkedin.com/in/jordanrivera"),
      github: c("https://github.com/jordanrivera"),
      portfolio: c("https://jordanrivera.dev"),
      website: c("https://jordanrivera.dev"),
      other: c([]),
    },
    experience: [
      { id: "e1", company: "Globex", title: "Software Engineer Intern", location: "Austin, TX", startDate: "2025-06", endDate: "2025-08", current: false, bullets: ["Built things"], confirmedByUser: true },
    ],
    education: [
      {
        id: "s1", school: "State University", degreeLevel: "bachelor", degree: "BS", major: "Computer Science", gpa: 3.7, gpaScale: 4,
        startDate: "2023-09", graduationDate: "2027-05", graduationExpected: true, honors: [], confirmedByUser: true,
      },
    ],
    skills: c(["TypeScript"]),
    workAuthorization: {
      authorizedCountries: c([{ country: "US", authorized: !sponsorship }]),
      requiresSponsorshipNow: c(sponsorship),
      requiresSponsorshipFuture: c(sponsorship),
      visaType: c(sponsorship ? "H-1B" : "U.S. Citizen"),
      citizenship: c(sponsorship ? ["IN"] : ["US"]),
      securityClearance: c("none"),
    },
    preferences: {
      desiredSalary: c(150000), salaryCurrency: c("USD"), earliestStartDate: c("2027-06-01"), noticePeriodWeeks: c(2), willingToRelocate: c(true),
    },
    eeo: {
      gender: c("decline"), raceEthnicity: c(["decline"]), hispanicLatino: c("decline"), veteranStatus: c("not_protected_veteran"),
      disabilityStatus: c("no"), sexualOrientation: c("decline"), transgender: c("decline"),
    },
    screening: {
      over18: c(true), hasCriminalConviction: c(false), criminalConvictionExplanation: c(""), previousEmployers: c([]), hasNonCompete: c(false),
      nonCompeteDetails: c(""), relativesAtCompanies: c([]), howDidYouHear: c("LinkedIn"), willingBackgroundCheck: c(true), willingDrugTest: c(true),
      skillYears: c([{ skill: "TypeScript", years: 2 }]), acceptAttestations: c(true),
    },
  } as ProfileInput;
  return ProfileSchema.parse(input);
}

function ctx(p: Profile): ResolveContext {
  return {
    profile: p,
    findBankAnswer: () => null,
    llm: null,
    threshold: 0.85,
    company: "Northwind Labs",
    documents: { resume: { path: RESUME, filename: "sample-resume.pdf" } },
  };
}

const ESSAY = "I admire Northwind Labs' focus on developer tooling and want to build it.";

function toAnswers(resolutions: Resolution[]): Map<string, FieldAnswer> {
  const m = new Map<string, FieldAnswer>();
  for (const r of resolutions) {
    if (r.answer) m.set(r.fieldId, r.answer);
    else if (r.status === "needs_draft" && /interested in/i.test(r.label)) m.set(r.fieldId, { kind: "text", value: ESSAY });
  }
  return m;
}

let srv: FixtureServer;
let browser: Browser;
let page: Page;
const job = (id: string) => `${srv.url}/greenhouse/northwind/jobs/${id}`;

beforeAll(async () => {
  srv = await startFixtureServer({ port: 0 });
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await srv?.close();
});
beforeEach(async () => {
  srv.reset();
  page = await (await browser.newContext()).newPage();
});

const byLabel = (fields: FormField[], label: string) => {
  const f = fields.find((x) => x.label === label);
  if (!f) throw new Error(`no field "${label}" in ${fields.map((x) => x.label).join(" | ")}`);
  return f;
};

describe("greenhouse open", () => {
  it("opens a normal posting as a form", T, async () => {
    expect(await gh.open(page, job("4410001"))).toEqual({ kind: "form" });
  });
  it("reports closed postings", T, async () => {
    const s = await gh.open(page, job("4410007"));
    expect(s.kind).toBe("closed");
  });
  it("opens the server-error variant as a form", T, async () => {
    expect(await gh.open(page, job("4410006"))).toEqual({ kind: "form" });
  });
  it("detects a captcha widget", T, async () => {
    await page.route("**/captcha", (r) => r.fulfill({ contentType: "text/html", body: `<form id="application-form"><div class="g-recaptcha"></div><button type="submit">Submit application</button></form>` }));
    const s = await gh.open(page, `${srv.url}/captcha`);
    expect(s).toMatchObject({ kind: "blocked", reason: "captcha" });
  });
  it("follows an Apply link to the form", T, async () => {
    await page.route("**/posting", (r) => r.fulfill({ contentType: "text/html", body: `<h1>Job</h1><a href="${job("4410001")}">Apply</a>` }));
    expect(await gh.open(page, `${srv.url}/posting`)).toEqual({ kind: "form" });
  });
});

describe("greenhouse extractForm", () => {
  it("extracts labels, types, required flags and combobox options", T, async () => {
    await gh.open(page, job("4410001"));
    const fields = await gh.extractForm(page);
    const f = (l: string) => byLabel(fields, l);
    expect(f("First Name")).toMatchObject({ id: "first_name", type: "text", required: true });
    expect(f("Email")).toMatchObject({ type: "email", required: true });
    expect(f("Phone")).toMatchObject({ type: "tel", required: true });
    expect(f("Resume/CV")).toMatchObject({ id: "resume", type: "file", required: true });
    expect(f("Cover Letter")).toMatchObject({ type: "file", required: false });
    expect(f("LinkedIn Profile").required).toBe(false);
    expect(f("Why are you interested in Northwind Labs?")).toMatchObject({ type: "textarea", required: false });
    expect(f("Country")).toMatchObject({ id: "country", type: "select", required: true });
    expect(f("Country").options?.map((o) => o.label)).toContain("United States");
    expect(f("Gender")).toMatchObject({ id: "gender", type: "select", required: false });
    expect(f("Gender").options?.map((o) => o.label)).toEqual(["Male", "Female", "Decline To Self Identify"]);
    expect(f("Veteran Status").options?.map((o) => o.label)).toContain("I am not a protected veteran");
    expect(f("Are you legally authorized to work in the United States?").options).toEqual([
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" },
    ]);
    // Conditional visa field is hidden/disabled until sponsorship is answered Yes.
    expect(fields.some((x) => /visa/i.test(x.label))).toBe(false);
    expect(fields.some((x) => x.label.includes("*"))).toBe(false);
  });

  it("reads options by opening a listbox when data-options is absent", T, async () => {
    await gh.open(page, job("4410001"));
    await page.evaluate(`document.querySelectorAll('[data-options]').forEach(function (w) { w.removeAttribute('data-options'); })`);
    const gender = byLabel(await gh.extractForm(page), "Gender");
    expect(gender.options?.map((o) => o.label)).toEqual(["Male", "Female", "Decline To Self Identify"]);
    expect(await page.locator("[role=listbox]").count()).toBe(0);
  });

  it("handles radio groups, checkbox groups, native selects", T, async () => {
    await page.route("**/generic", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: `<form><fieldset><legend>Pick one <span aria-hidden="true">*</span></legend>
<label><input type="radio" name="r" value="a" required> Alpha</label><label><input type="radio" name="r" value="b"> Beta</label></fieldset>
<fieldset><legend>Languages</legend><label><input type="checkbox" name="l" value="ts"> TypeScript</label><label><input type="checkbox" name="l" value="go"> Go</label></fieldset>
<label><input type="checkbox" name="agree"> I agree</label>
<label for="s">Size</label><select id="s" name="s"><option value="">Select</option><option value="1">Small</option><option value="2">Large</option></select>
<input type="text" name="hid" style="display:none" aria-label="Hidden"><input type="text" name="off" disabled aria-label="Off">
<button type="submit">Submit</button></form>`,
      }),
    );
    await page.goto(`${srv.url}/generic`);
    const fields = await gh.extractForm(page);
    expect(fields).toEqual([
      { id: "r", label: "Pick one", type: "radio", required: true, options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] },
      { id: "l", label: "Languages", type: "checkbox", multiple: true, required: false, options: [{ value: "ts", label: "TypeScript" }, { value: "go", label: "Go" }] },
      { id: "agree", label: "I agree", type: "checkbox", required: false },
      { id: "s", label: "Size", type: "select", required: false, options: [{ value: "1", label: "Small" }, { value: "2", label: "Large" }] },
    ]);
    await gh.fill(
      page,
      new Map<string, FieldAnswer>([
        ["r", { kind: "option", values: ["b"] }],
        ["l", { kind: "option", values: ["go"] }],
        ["agree", { kind: "boolean", value: true }],
        ["s", { kind: "option", values: ["2"] }],
      ]),
    );
    expect(await page.locator("input[name=r][value=b]").isChecked()).toBe(true);
    expect(await page.locator("input[name=l][value=go]").isChecked()).toBe(true);
    expect(await page.locator("input[name=l][value=ts]").isChecked()).toBe(false);
    expect(await page.locator("input[name=agree]").isChecked()).toBe(true);
    expect(await page.locator("#s").inputValue()).toBe("2");
    await expect(gh.fill(page, new Map([["r", { kind: "option", values: ["zzz"] }]]))).rejects.toThrow(/no radio option/);
    await expect(gh.fill(page, new Map([["nope", { kind: "text", value: "x" }]]))).rejects.toThrow(/not found/);
  });
});

describe("greenhouse end to end", () => {
  async function applyAll(jobId: string, p: Profile) {
    expect(await gh.open(page, job(jobId))).toEqual({ kind: "form" });
    const fields = await gh.extractForm(page);
    const resolutions = await resolveForm(fields, ctx(p));
    await gh.fill(page, toAnswers(resolutions));
    return { fields, resolutions };
  }

  it("submits a record matching the profile field for field", T, async () => {
    const p = profile();
    const { resolutions } = await applyAll("4410001", p);
    expect(resolutions.filter((r) => r.status === "needs_input")).toEqual([]);

    expect(await gh.submit(page)).toEqual({ ok: true });
    expect(await gh.confirmSubmitted(page)).toBe(true);

    const subs = srv.submissions();
    expect(subs).toHaveLength(1);
    const { fields, files } = subs[0]!;
    expect(fields).toMatchObject({
      first_name: "Jordan",
      last_name: "Rivera",
      email: "jordan.rivera@example.com",
      country: "United States",
      question_40100001: "https://linkedin.com/in/jordanrivera",
      question_40100002: "https://jordanrivera.dev",
      question_40100003: "Yes",
      question_40100004: "No",
      question_40100006: ESSAY,
      gender: "Decline To Self Identify",
      hispanic_ethnicity: "Decline To Self Identify",
      veteran_status: "I am not a protected veteran",
      disability_status: "No, I do not have a disability and have not had one in the past",
    });
    expect(String(fields.phone).replace(/\D/g, "")).toContain("5550142020");
    expect(files.resume?.filename).toBe("sample-resume.pdf");
    expect(files.cover_letter?.filename ?? "").toBe("");
  });

  it("reveals the visa field for a sponsorship-needing applicant", T, async () => {
    const p = profile(true);
    await gh.open(page, job("4410005"));
    const first = await gh.extractForm(page);
    expect(first.some((f) => /visa/i.test(f.label))).toBe(false);
    const answers = toAnswers(await resolveForm(first, ctx(p)));
    await gh.fill(page, answers);

    const second = await gh.extractForm(page);
    const visa = second.find((f) => f.label === "What visa type will you need?");
    expect(visa).toMatchObject({ type: "text", required: true });
    const res = await resolveForm(second, ctx(p));
    // The resolver deliberately leaves "What visa type will you need?" (a future visa) for the user.
    expect(res.filter((r) => r.status === "needs_input").map((r) => r.fieldId)).toEqual([visa!.id]);
    await gh.fill(page, new Map<string, FieldAnswer>([[visa!.id, { kind: "text", value: "H-1B" }]]));

    expect(await gh.submit(page)).toEqual({ ok: true });
    const rec = srv.submissions()[0]!.fields;
    expect(rec.question_40100004).toBe("Yes");
    expect(rec.question_40100005).toBe("H-1B");
  });

  it("returns an error outcome and records nothing on a server error", T, async () => {
    await applyAll("4410006", profile());
    const out = await gh.submit(page);
    expect(out).toMatchObject({ ok: false, reason: "error" });
    expect(srv.submissions()).toHaveLength(0);
    expect(await gh.confirmSubmitted(page)).toBe(false);
  });

  it("reports validation errors when the resume is missing", T, async () => {
    expect(await gh.open(page, job("4410001"))).toEqual({ kind: "form" });
    const fields = await gh.extractForm(page);
    const answers = toAnswers(await resolveForm(fields, ctx(profile())));
    answers.delete("resume");
    await gh.fill(page, answers);
    const out = await gh.submit(page);
    expect(out).toMatchObject({ ok: false, reason: "validation_error" });
    expect((out as { message: string }).message).toContain("Resume is required");
    expect(srv.submissions()).toHaveLength(0);
  });
});

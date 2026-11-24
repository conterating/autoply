import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ProfileSchema, type FieldAnswer, type FormField, type Profile, type ProfileInput } from "@autoply/core";
import { resolveForm } from "@autoply/core/resolver";

import { startFixtureServer, type FixtureServer } from "../../../../tests/fixtures/ats/src/index.ts";
import { ashbyAdapter } from "../../src/adapters/ashby.ts";

const BOARD = "fabrikam";
const PLAIN = "ab5b1000-7e57-4a11-8c00-000000000001";
const CONDITIONAL = "ab5b1000-7e57-4a11-8c00-000000000005";
const MULTI = "ab5b1000-7e57-4a11-8c00-000000000006";
const RESUME = resolve(import.meta.dirname, "../../../../tests/fixtures/resumes/sample-resume.pdf");

const Q = (n: number) => `5d0a1c00-0000-4000-8000-00000000000${n}`;

const c = <T>(value: T) => ({ value, confirmedByUser: true });

function profile(tweak?: (p: Profile) => void): Profile {
  const input = {
    version: 1,
    identity: {
      legalFirstName: c("Jordan"),
      legalLastName: c("Rivera"),
      email: c("jordan.rivera@example.com"),
      phoneCountryCode: c("+1"),
      phoneNumber: c("5125550142"),
      city: c("Austin"),
      state: c("TX"),
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
    screening: { acceptAttestations: c(true) },
  } as ProfileInput;
  const p = ProfileSchema.parse(input);
  tweak?.(p);
  return p;
}

async function answersFor(fields: FormField[], p: Profile): Promise<Map<string, FieldAnswer>> {
  const resolutions = await resolveForm(fields, {
    profile: p,
    company: "Fabrikam AI",
    findBankAnswer: () => null,
    llm: null,
    threshold: 0.85,
    documents: { resume: { path: RESUME, filename: "sample-resume.pdf" } },
  });
  const m = new Map<string, FieldAnswer>();
  for (const r of resolutions) {
    if (r.status === "answered" && r.answer) m.set(r.fieldId, r.answer);
    else if (r.fieldId === Q(6)) m.set(r.fieldId, { kind: "text", value: "I enjoy building reliable software with a small team." });
    else if (r.fieldId === Q(5)) m.set(r.fieldId, { kind: "option", values: ["TypeScript", "Python"] });
  }
  return m;
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
  if (page) await page.context().close();
  page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(15_000);
});

const overviewUrl = (id: string) => `${server.url}/ashby/${BOARD}/${id}`;

describe("ashby adapter", () => {
  it("opens from the overview page to the application form", async () => {
    const state = await ashbyAdapter.open(page, overviewUrl(PLAIN));
    expect(state).toEqual({ kind: "form" });
    expect(page.url()).toMatch(/\/application$/);
  });

  it("reports closed postings", async () => {
    const state = await ashbyAdapter.open(page, overviewUrl("ab5b1000-7e57-4a11-8c00-0000000000ff"));
    expect(state.kind).toBe("closed");
  });

  it("extracts yes/no buttons, checkbox groups, EEO radios and required flags", async () => {
    await ashbyAdapter.open(page, overviewUrl(PLAIN));
    const fields = await ashbyAdapter.extractForm(page);
    const byId = new Map(fields.map((f) => [f.id, f]));

    expect(byId.get("_systemfield_name")).toMatchObject({ label: "Name", type: "text", required: true });
    expect(byId.get("_systemfield_email")).toMatchObject({ type: "email", required: true });
    expect(byId.get("_systemfield_phone")).toMatchObject({ type: "tel", required: false });
    expect(byId.get("_systemfield_resume")).toMatchObject({ type: "file", required: true });
    expect(byId.get(Q(1))).toMatchObject({ label: "LinkedIn URL", required: false });

    const auth = byId.get(Q(2))!;
    expect(auth).toMatchObject({ type: "radio", required: true, label: "Are you legally authorized to work in the United States?" });
    expect(auth.options).toEqual([
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" },
    ]);
    expect(byId.get(Q(3))).toMatchObject({ type: "radio", label: "Will you require sponsorship?" });

    expect(byId.has(Q(4))).toBe(false); // conditional visa field absent in the plain posting
    const langs = byId.get(Q(5))!;
    expect(langs).toMatchObject({ type: "checkbox", multiple: true });
    expect(langs.options!.map((o) => o.label)).toEqual(["TypeScript", "Python", "Go", "Java", "Rust"]);
    expect(fields.filter((f) => f.id === Q(5))).toHaveLength(1);
    expect(byId.get(Q(6))).toMatchObject({ type: "textarea", required: true });

    const veteran = byId.get("eeoc_veteran_status")!;
    expect(veteran).toMatchObject({ type: "radio", label: "Veteran Status", required: false });
    expect(veteran.options!.map((o) => o.label)).toContain("I am not a protected veteran");
    expect(byId.get("eeoc_gender")!.options!.map((o) => o.label)).toContain("Decline to self-identify");
    expect(byId.get("eeoc_disability_status")!.options).toHaveLength(3);
    expect(fields.every((f) => f.page === undefined)).toBe(true);
  });

  it("fills and submits end to end using the real resolver", async () => {
    await ashbyAdapter.open(page, overviewUrl(PLAIN));
    const fields = await ashbyAdapter.extractForm(page);
    const answers = await answersFor(fields, profile());
    await ashbyAdapter.fill(page, answers);
    const outcome = await ashbyAdapter.submit(page);
    expect(outcome).toEqual({ ok: true });
    expect(await ashbyAdapter.confirmSubmitted(page)).toBe(true);

    const subs = server.submissions();
    expect(subs).toHaveLength(1);
    const { fields: f, files } = subs[0]!;
    expect(f._systemfield_name).toBe("Jordan Rivera");
    expect(f._systemfield_email).toBe("jordan.rivera@example.com");
    expect(String(f._systemfield_phone).replace(/\D/g, "")).toMatch(/5125550142$/);
    expect(f._systemfield_location).toMatch(/^Austin, TX/);
    expect(f[Q(1)]).toBe("https://www.linkedin.com/in/jordanrivera");
    expect(f[Q(2)]).toBe("Yes");
    expect(f[Q(3)]).toBe("No");
    expect([f[Q(5)]].flat().sort()).toEqual(["Python", "TypeScript"]);
    expect(f[Q(6)]).toContain("reliable software");
    expect(f.eeoc_gender).toBe("Decline to self-identify");
    expect(f.eeoc_race).toBe("Decline to self-identify");
    expect(f.eeoc_veteran_status).toBe("I am not a protected veteran");
    expect(f.eeoc_disability_status).toBe("No, I do not have a disability and have not had one in the past");
    expect(files._systemfield_resume?.filename).toBe("sample-resume.pdf");
    expect(files._systemfield_resume?.size).toBeGreaterThan(0);
  });

  it("is idempotent when filled twice", async () => {
    await ashbyAdapter.open(page, overviewUrl(PLAIN));
    const answers = await answersFor(await ashbyAdapter.extractForm(page), profile());
    await ashbyAdapter.fill(page, answers);
    await ashbyAdapter.fill(page, answers);
    expect(await ashbyAdapter.submit(page)).toEqual({ ok: true });
    expect([server.submissions()[0]!.fields[Q(5)]].flat().sort()).toEqual(["Python", "TypeScript"]);
  });

  it("handles the multi-page variant", async () => {
    await ashbyAdapter.open(page, overviewUrl(MULTI));
    const fields = await ashbyAdapter.extractForm(page);
    const byId = new Map(fields.map((f) => [f.id, f]));
    expect(byId.get("_systemfield_name")!.page).toBe(0);
    expect(byId.get(Q(2))!.page).toBe(0);
    expect(byId.get("eeoc_gender")!.page).toBe(1);
    expect(byId.get("eeoc_veteran_status")!.page).toBe(1);

    const answers = await answersFor(fields, profile());
    await ashbyAdapter.fill(page, answers);
    // Second fill from step 2 must navigate back instead of clicking Next blindly.
    await ashbyAdapter.fill(page, answers);
    expect(await ashbyAdapter.submit(page)).toEqual({ ok: true });

    const { fields: f } = server.submissions()[0]!;
    expect(f._systemfield_name).toBe("Jordan Rivera");
    expect(f.eeoc_gender).toBe("Decline to self-identify");
    expect(f.eeoc_veteran_status).toBe("I am not a protected veteran");
    expect(f.eeoc_disability_status).toMatch(/^No, /);
  });

  it("reveals the visa field in the conditional sponsorship variant", async () => {
    const p = profile((x) => {
      x.workAuthorization.requiresSponsorshipNow = c(true);
      x.workAuthorization.requiresSponsorshipFuture = c(true);
      x.workAuthorization.visaType = c("H-1B");
    });
    await ashbyAdapter.open(page, overviewUrl(CONDITIONAL));
    const first = await ashbyAdapter.extractForm(page);
    expect(first.some((f) => f.id === Q(4))).toBe(false);
    const answers = await answersFor(first, p);
    expect(answers.get(Q(3))).toMatchObject({ kind: "option", values: ["Yes"] });
    await ashbyAdapter.fill(page, answers);

    const second = await ashbyAdapter.extractForm(page);
    const visa = second.find((f) => f.id === Q(4));
    expect(visa).toBeDefined();
    const answers2 = await answersFor(second, p);
    // The resolver deliberately leaves "What visa type will you need?" to the user (needs_input);
    // supply the profile's visa type as the user's own answer.
    answers2.set(Q(4), { kind: "text", value: p.workAuthorization.visaType.value! });
    await ashbyAdapter.fill(page, answers2);

    expect(await ashbyAdapter.submit(page)).toEqual({ ok: true });
    const { fields: f } = server.submissions()[0]!;
    expect(f[Q(3)]).toBe("Yes");
    expect(f[Q(4)]).toBe("H-1B");
  });

  it("returns validation_error when the resume is missing", async () => {
    await ashbyAdapter.open(page, overviewUrl(PLAIN));
    const answers = await answersFor(await ashbyAdapter.extractForm(page), profile());
    answers.delete("_systemfield_resume");
    await ashbyAdapter.fill(page, answers);
    const outcome = await ashbyAdapter.submit(page);
    expect(outcome).toMatchObject({ ok: false, reason: "validation_error" });
    expect(server.submissions()).toHaveLength(0);
  });

  it("throws a descriptive error for an unknown option", async () => {
    await ashbyAdapter.open(page, overviewUrl(PLAIN));
    const fields = await ashbyAdapter.extractForm(page);
    const label = fields.find((f) => f.id === "eeoc_gender")!;
    await expect(ashbyAdapter.fill(page, new Map([[label.id, { kind: "option", values: ["Martian"] }]]))).rejects.toThrow(/no option "Martian"/);
    await expect(ashbyAdapter.fill(page, new Map([["nope", { kind: "text", value: "x" }]]))).rejects.toThrow(/nope/);
  });
});

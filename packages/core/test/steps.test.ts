import { describe, expect, it } from "vitest";
import { emptyProfile } from "../src/profile/schema.ts";
import { applyStep, completeOnboarding, StepValidationError } from "../src/profile/steps.ts";
import { ONBOARDING_STEPS } from "../src/profile/schema.ts";

const identity = {
  identity: {
    legalFirstName: "Jordan",
    legalLastName: "Rivera",
    email: "jordan.rivera@example.com",
    phoneCountryCode: "+1",
    phoneNumber: "(555) 010-4477",
    legalMiddleName: "",
  },
  links: { linkedin: "https://linkedin.com/in/x" },
};

describe("applyStep", () => {
  it("confirms every non-empty submitted value and leaves blanks unconfirmed", () => {
    const p = applyStep(emptyProfile(), "identity", identity);
    expect(p.identity.legalFirstName).toEqual({ value: "Jordan", confirmedByUser: true });
    expect(p.identity.legalMiddleName).toEqual({ value: null, confirmedByUser: false });
    expect(p.links.linkedin.confirmedByUser).toBe(true);
  });

  it("advances onboarding and records the completed step", () => {
    const p = applyStep(emptyProfile(), "identity", identity);
    expect(p.onboarding.completedSteps).toEqual(["identity"]);
    expect(p.onboarding.currentStep).toBe("experience");
  });

  it("can save without advancing (profile editor)", () => {
    const p = applyStep(emptyProfile(), "identity", identity, { advance: false });
    expect(p.onboarding.completedSteps).toEqual([]);
    expect(p.onboarding.currentStep).toBe("resume");
  });

  it("requires the core identity fields", () => {
    expect(() => applyStep(emptyProfile(), "identity", { identity: { legalFirstName: "J" } })).toThrow(StepValidationError);
  });

  it("reports schema errors with readable paths", () => {
    try {
      applyStep(emptyProfile(), "identity", { identity: { ...identity.identity, email: "nope" } });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(StepValidationError);
      expect((e as StepValidationError).issues.map((i) => i.path)).toContain("identity.email");
    }
  });

  it("requires explicit work authorization and sponsorship answers", () => {
    expect(() => applyStep(emptyProfile(), "authorization", { workAuthorization: { requiresSponsorshipNow: false } })).toThrow(
      /Sponsorship in the future is required/,
    );
    const p = applyStep(emptyProfile(), "authorization", {
      workAuthorization: {
        authorizedCountries: [{ country: "US", authorized: true }],
        requiresSponsorshipNow: false,
        requiresSponsorshipFuture: false,
      },
    });
    expect(p.workAuthorization.requiresSponsorshipNow).toEqual({ value: false, confirmedByUser: true });
  });

  it("treats `false` as an answer, not a blank", () => {
    const p = applyStep(emptyProfile(), "screening", { screening: { over18: true, hasCriminalConviction: false } });
    expect(p.screening.hasCriminalConviction).toEqual({ value: false, confirmedByUser: true });
  });

  it("confirms the EEO decline defaults when the user submits them", () => {
    const before = emptyProfile();
    const values = Object.fromEntries(Object.entries(before.eeo).map(([k, f]) => [k, f.value]));
    const p = applyStep(before, "eeo", { eeo: values });
    for (const f of Object.values(p.eeo)) expect(f.confirmedByUser).toBe(true);
  });

  it("marks submitted list entries confirmed", () => {
    const p = applyStep(emptyProfile(), "experience", {
      experience: [{ id: "a", company: "Acme", title: "Engineer", startDate: "2024-01", bullets: ["Did things"] }],
    });
    expect(p.experience[0]).toMatchObject({ company: "Acme", confirmedByUser: true, current: false });
  });

  it("rejects unknown fields", () => {
    expect(() => applyStep(emptyProfile(), "identity", { identity: { ...identity.identity, shoeSize: 9 } })).toThrow(/Unknown field/);
  });
});

describe("completeOnboarding", () => {
  it("refuses until every step is done", () => {
    expect(() => completeOnboarding(emptyProfile())).toThrow(StepValidationError);
  });

  it("stamps completion when every step is done", () => {
    const p = emptyProfile();
    p.onboarding.completedSteps = ONBOARDING_STEPS.filter((s) => s !== "review");
    const done = completeOnboarding(p, new Date("2026-01-01T00:00:00Z"));
    expect(done.onboarding.completedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

import { describe, expect, it } from "vitest";
import { DECLINE, emptyProfile, ProfileSchema } from "../src/profile/schema.ts";

describe("ProfileSchema", () => {
  it("builds a complete empty profile from nothing", () => {
    const p = emptyProfile();
    expect(p.version).toBe(1);
    expect(p.identity.legalFirstName).toEqual({ value: null, confirmedByUser: false });
    expect(p.experience).toEqual([]);
    expect(p.onboarding.currentStep).toBe("resume");
    expect(p.preferences.salaryCurrency).toEqual({ value: "USD", confirmedByUser: false });
  });

  it("defaults every EEO field to decline, unconfirmed", () => {
    const { eeo } = emptyProfile();
    for (const [key, f] of Object.entries(eeo)) {
      const value = Array.isArray(f.value) ? f.value : [f.value];
      expect(value, key).toEqual([DECLINE]);
      expect(f.confirmedByUser, key).toBe(false);
    }
  });

  it("leaves every legal field empty and unconfirmed by default", () => {
    const { workAuthorization, screening } = emptyProfile();
    for (const f of Object.values(workAuthorization)) expect(f).toEqual({ value: null, confirmedByUser: false });
    expect(screening.over18).toEqual({ value: null, confirmedByUser: false });
    expect(screening.hasCriminalConviction).toEqual({ value: null, confirmedByUser: false });
  });

  it("wraps every scalar field in { value, confirmedByUser }", () => {
    const p = emptyProfile();
    const sections = ["identity", "links", "workAuthorization", "preferences", "eeo", "screening", "voice"] as const;
    for (const s of sections) {
      for (const [k, f] of Object.entries(p[s])) {
        expect(Object.keys(f as object).sort(), `${s}.${k}`).toEqual(["confirmedByUser", "value"]);
      }
    }
  });

  it("fills list-entry defaults", () => {
    const p = ProfileSchema.parse({
      experience: [{ id: "e1", company: "Acme", title: "Engineer" }],
      education: [{ id: "s1", school: "State U" }],
    });
    expect(p.experience[0]).toMatchObject({ current: false, bullets: [], confirmedByUser: false, startDate: null });
    expect(p.education[0]).toMatchObject({ gpaScale: 4, graduationExpected: false, honors: [] });
  });

  it("preserves confirmed values through a round trip", () => {
    const input = emptyProfile();
    input.identity.email = { value: "ada@example.com", confirmedByUser: true };
    input.eeo.veteranStatus = { value: "not_protected_veteran", confirmedByUser: true };
    input.workAuthorization.requiresSponsorshipNow = { value: false, confirmedByUser: true };
    const out = ProfileSchema.parse(JSON.parse(JSON.stringify(input)));
    expect(out).toEqual(input);
  });

  it.each([
    ["invalid email", { identity: { email: { value: "not-an-email", confirmedByUser: true } } }],
    ["bad phone country code", { identity: { phoneCountryCode: { value: "1", confirmedByUser: true } } }],
    ["bad month", { experience: [{ id: "e", company: "A", title: "B", startDate: "2024-13" }] }],
    ["GPA out of range", { education: [{ id: "s", school: "U", gpa: 11 }] }],
    ["unknown veteran status", { eeo: { veteranStatus: { value: "maybe", confirmedByUser: true } } }],
    ["unknown seniority", { preferences: { seniority: { value: ["wizard"], confirmedByUser: true } } }],
    ["empty race list", { eeo: { raceEthnicity: { value: [], confirmedByUser: true } } }],
    ["missing confirmedByUser", { identity: { city: { value: "Austin" } } }],
  ])("rejects %s", (_name, input) => {
    expect(ProfileSchema.safeParse(input).success).toBe(false);
  });

  it("allows null values for unanswered fields", () => {
    const r = ProfileSchema.safeParse({ identity: { email: { value: null, confirmedByUser: false } } });
    expect(r.success).toBe(true);
  });
});

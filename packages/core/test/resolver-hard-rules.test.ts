/**
 * Hard rule 1 (CLAUDE.md): legal and demographic questions are never answered
 * by the LLM and are filled only from profile values the user confirmed.
 */
import { describe, expect, it } from "vitest";
import { FakeLlm } from "../src/llm/index.ts";
import { emptyProfile, ProfileSchema, type Profile, type ProfileInput } from "../src/profile/schema.ts";
import {
  CATALOG,
  deterministicMatch,
  isSensitiveKey,
  resolveField,
  type FormField,
  type Resolution,
  type ResolveContext,
} from "../src/resolver/index.ts";
import { GOLDEN, type GoldenItem } from "../../../tests/fixtures/resolver/golden.ts";

// ------------------------------------------------------------------ helpers

const c = <T>(value: T) => ({ value, confirmedByUser: true });

function confirmedInput(): ProfileInput {
  return {
    version: 1,
    identity: {
      legalFirstName: c("Avery"),
      legalMiddleName: c("J"),
      legalLastName: c("Quinn"),
      preferredName: c("Ave"),
      pronouns: c("they/them"),
      email: c("avery@example.com"),
      phoneCountryCode: c("+1"),
      phoneNumber: c("5551234567"),
      addressLine1: c("1 Main St"),
      addressLine2: c("Apt 4"),
      city: c("Austin"),
      state: c("TX"),
      postalCode: c("78701"),
      country: c("United States"),
    },
    links: {
      linkedin: c("https://linkedin.com/in/averyquinn"),
      github: c("https://github.com/averyquinn"),
      portfolio: c("https://averyquinn.dev"),
      website: c("https://averyquinn.dev/blog"),
      other: c([]),
    },
    experience: [
      {
        id: "e1",
        company: "Globex",
        title: "Software Engineer",
        location: "Austin, TX",
        startDate: "2019-06",
        endDate: null,
        current: true,
        bullets: ["Built things"],
        confirmedByUser: true,
      },
    ],
    education: [
      {
        id: "s1",
        school: "State University",
        degreeLevel: "bachelor",
        degree: "BS",
        major: "Computer Science",
        gpa: 3.7,
        gpaScale: 4,
        startDate: "2015-09",
        graduationDate: "2019-05",
        graduationExpected: false,
        honors: [],
        confirmedByUser: true,
      },
    ],
    skills: { value: ["TypeScript"], confirmedByUser: true },
    workAuthorization: {
      authorizedCountries: c([{ country: "US", authorized: true }]),
      requiresSponsorshipNow: c(false),
      requiresSponsorshipFuture: c(false),
      visaType: c("U.S. Citizen"),
      citizenship: c(["US"]),
      securityClearance: c("none"),
    },
    preferences: {
      desiredSalary: c(150000),
      salaryCurrency: c("USD"),
      earliestStartDate: c("2026-12-01"),
      noticePeriodWeeks: c(2),
      willingToRelocate: c(true),
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
    screening: {
      over18: c(true),
      hasCriminalConviction: c(false),
      criminalConvictionExplanation: c(""),
      previousEmployers: c([]),
      hasNonCompete: c(false),
      nonCompeteDetails: c(""),
      relativesAtCompanies: c([]),
      howDidYouHear: c("LinkedIn"),
      willingBackgroundCheck: c(true),
      willingDrugTest: c(true),
      skillYears: c([{ skill: "TypeScript", years: 6 }]),
      acceptAttestations: c(true),
    },
  } as ProfileInput;
}

/** A fully confirmed, realistic profile. `tweak` edits it before parsing. */
function confirmedProfile(tweak?: (p: Profile) => void): Profile {
  const p = ProfileSchema.parse(confirmedInput());
  tweak?.(p);
  return p;
}

/** Same values, but nothing the user has confirmed. */
function unconfirmedProfile(): Profile {
  const p = structuredClone(confirmedProfile());
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    if (!Array.isArray(o) && typeof (o as Record<string, unknown>).confirmedByUser === "boolean") (o as Record<string, unknown>).confirmedByUser = false;
    for (const v of Object.values(o)) walk(v);
  };
  walk(p);
  return p;
}

function ctxFor(profile: Profile, extra: Partial<ResolveContext> = {}): ResolveContext {
  return {
    profile,
    findBankAnswer: () => null,
    llm: null,
    threshold: 0.85,
    company: "Acme",
    documents: { resume: { path: "/tmp/r.pdf", filename: "r.pdf" } },
    ...extra,
  };
}

const opts = (labels: string[]) => labels.map((label, i) => ({ value: `o${i}`, label }));
const YN = ["Yes", "No"];

function mk(label: string, extra: Partial<FormField> & { labels?: string[] } = {}): FormField {
  const { labels, ...rest } = extra;
  const options = labels ? opts(labels) : rest.options;
  return { id: "f", label, type: options ? "radio" : "text", required: true, ...rest, options };
}

function fieldOfGolden(item: GoldenItem): FormField {
  return mk(item.label, {
    type: (item.type ?? (item.options ? "radio" : "text")) as FormField["type"],
    labels: item.options,
  });
}

const chosenLabels = (r: Resolution, f: FormField): string[] =>
  r.answer?.kind === "option" ? r.answer.values.map((v) => f.options!.find((o) => o.value === v)!.label) : [];

// One representative golden item per sensitive catalog key.
const SENSITIVE_KEYS = CATALOG.filter((e) => isSensitiveKey(e.key)).map((e) => e.key);
const REPRESENTATIVE = new Map<string, GoldenItem>();
for (const key of SENSITIVE_KEYS) {
  const item = GOLDEN.find((g) => g.expected === key);
  if (item) REPRESENTATIVE.set(key, item);
}
const ALWAYS_NEEDS_INPUT = new Set(["ssn", "date_of_birth", "accommodation"]);

// ------------------------------------------------------------------ sensitive keys

describe("every sensitive catalog key", () => {
  it("has a representative golden question", () => {
    expect(SENSITIVE_KEYS.length).toBeGreaterThan(20);
    expect(SENSITIVE_KEYS.filter((k) => !REPRESENTATIVE.has(k))).toEqual([]);
  });

  describe.each(SENSITIVE_KEYS)("%s", (key) => {
    const item = REPRESENTATIVE.get(key)!;
    const field = fieldOfGolden(item);

    it("matches its representative question deterministically", () => {
      expect(deterministicMatch(field)?.entry.key).toBe(key);
    });

    it("needs input against an empty profile", async () => {
      const r = await resolveField(field, ctxFor(emptyProfile()));
      expect(r.status).toBe("needs_input");
      expect(r.sensitive).toBe(true);
      expect(r.answer).toBeUndefined();
    });

    it("needs input when the value is set but not confirmed", async () => {
      const r = await resolveField(field, ctxFor(unconfirmedProfile()));
      expect(r.status).toBe("needs_input");
      expect(r.answer).toBeUndefined();
    });

    it("never skips or drafts even when the field is optional", async () => {
      for (const profile of [emptyProfile(), unconfirmedProfile()]) {
        const r = await resolveField({ ...field, required: false }, ctxFor(profile));
        expect(r.status).toBe("needs_input");
      }
    });

    it("is answered from the confirmed profile (except ssn, date of birth, accommodation)", async () => {
      const r = await resolveField(field, ctxFor(confirmedProfile()));
      if (ALWAYS_NEEDS_INPUT.has(key)) {
        expect(r.status).toBe("needs_input");
      } else {
        expect(r.status, r.reason).toBe("answered");
        expect(r.source).toBe("profile");
      }
    });
  });

  it("routes every golden question with a sensitive expected key to the user when nothing is confirmed", async () => {
    const bad: string[] = [];
    for (const item of GOLDEN.filter((g) => isSensitiveKey(g.expected))) {
      for (const profile of [emptyProfile(), unconfirmedProfile()]) {
        for (const required of [true, false]) {
          const r = await resolveField({ ...fieldOfGolden(item), required }, ctxFor(profile));
          if (r.status !== "needs_input") bad.push(`${item.label} (required=${required}) -> ${r.status}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

// ------------------------------------------------------------------ LLM never answers

describe("the LLM never supplies a sensitive answer", () => {
  const throwing = (task: string) => () => {
    throw new Error(`${task} must not be called for a sensitive question`);
  };

  it("classifies an unusual phrasing but the answer comes from the profile", async () => {
    const label = "Pls confirm u can legally take a job in the US";
    const f = mk(label, { labels: YN });
    expect(deterministicMatch(f)).toBeNull();
    const llm = new FakeLlm({
      classify_question: () => ({ key: "work_authorized", confidence: 0.99 }),
      write_answer: throwing("write_answer"),
      write_cover_letter: throwing("write_cover_letter"),
    });
    const r = await resolveField(f, ctxFor(confirmedProfile(), { llm }));
    expect(r.status).toBe("answered");
    expect(r.source).toBe("profile");
    expect(r.matchedBy).toBe("llm");
    expect(r.canonicalKey).toBe("work_authorized");
    expect(chosenLabels(r, f)).toEqual(["Yes"]);
    expect(llm.calls.map((x) => x.task)).toEqual(["classify_question"]);
  });

  it("needs input when the profile has no confirmed value, even with a confident classification", async () => {
    const f = mk("Pls confirm u can legally take a job in the US", { labels: YN });
    const llm = new FakeLlm({
      classify_question: () => ({ key: "work_authorized", confidence: 0.99 }),
      write_answer: throwing("write_answer"),
    });
    for (const profile of [emptyProfile(), unconfirmedProfile()]) {
      const r = await resolveField(f, ctxFor(profile, { llm }));
      expect(r.status).toBe("needs_input");
      expect(r.answer).toBeUndefined();
    }
    expect(llm.calls.every((x) => x.task === "classify_question")).toBe(true);
  });

  it("needs input when classification is below the threshold", async () => {
    const f = mk("Pls confirm u can legally take a job in the US", { labels: YN });
    const llm = new FakeLlm({ classify_question: () => ({ key: "work_authorized", confidence: 0.6 }), write_answer: throwing("write_answer") });
    const r = await resolveField(f, ctxFor(confirmedProfile(), { llm }));
    expect(r.status).toBe("needs_input");
    expect(r.answer).toBeUndefined();
    expect(r.matchedBy).toBe("llm");
  });

  const UNUSUAL: [string, string, Partial<FormField> & { labels?: string[] }][] = [
    ["Pls confirm u can legally take a job in the US", "work_authorized", { labels: YN }],
    ["Which best describes how you self-report your identity re: orientation?", "sexual_orientation", {}],
    ["Tell us about your service history", "veteran", {}],
    ["Do you live with any long-term health condition?", "disability", {}],
  ];

  it.each(UNUSUAL)("%s -> %s: profile only, no writing calls", async (label, key, extra) => {
    const f = mk(label, extra);
    expect(deterministicMatch(f)).toBeNull();
    const llm = new FakeLlm({
      classify_question: () => ({ key, confidence: 0.99 }),
      write_answer: throwing("write_answer"),
      write_cover_letter: throwing("write_cover_letter"),
    });
    const empty = await resolveField(f, ctxFor(emptyProfile(), { llm }));
    expect(empty.status).toBe("needs_input");
    const full = await resolveField(f, ctxFor(confirmedProfile(), { llm }));
    expect(full.status, full.reason).toBe("answered");
    expect(full.source).toBe("profile");
    expect(llm.calls.every((x) => x.task === "classify_question")).toBe(true);
  });

  it.each([
    ["Describe your immigration history", "textarea"],
    ["Describe your immigration history", "text"],
    ["Please explain your immigration history and current status in detail", "textarea"],
    ["Tell us about any arrests", "textarea"],
    ["Tell us about your religious beliefs and background", "textarea"],
    ["Describe your marital status and family plans", "textarea"],
  ] as const)("novel sensitive question %j (%s) never goes to the writer", async (label, type) => {
    const llm = new FakeLlm({
      classify_question: () => ({ key: "novel", confidence: 0.9 }),
      write_answer: throwing("write_answer"),
      write_cover_letter: throwing("write_cover_letter"),
    });
    for (const ctx of [ctxFor(confirmedProfile()), ctxFor(confirmedProfile(), { llm })]) {
      const r = await resolveField(mk(label, { type }), ctx);
      expect(r.status).toBe("needs_input");
      expect(r.sensitive).toBe(true);
      expect(r.answer).toBeUndefined();
    }
    expect(llm.calls.every((x) => x.task === "classify_question")).toBe(true);
  });

  it("a non-sensitive essay is still drafted (sanity check that the rule is targeted)", async () => {
    const r = await resolveField(mk("Why do you want to work at Acme?", { type: "textarea" }), ctxFor(confirmedProfile()));
    expect(r.status).toBe("needs_draft");
  });
});

// ------------------------------------------------------------------ decline wording

const DECLINE_WORDINGS = [
  "Decline To Self Identify",
  "Decline to self-identify",
  "Decline to state",
  "Decline to answer",
  "Decline to identify",
  "I decline to self-identify",
  "I don't wish to answer",
  "I don’t wish to answer",
  "I do not wish to answer",
  "I do not wish to self-identify",
  "I do not want to answer",
  "I don’t want to answer",
  "Prefer not to say",
  "Prefer not to answer",
  "Prefer Not To Disclose",
  "Prefer not to respond",
  "I prefer not to disclose",
  "I prefer not to answer",
  "Choose not to disclose",
  "I choose not to disclose",
  "I choose not to self-identify",
  "I wish not to answer",
  "I would rather not say",
  "Rather not say",
  "Not specified",
  "Not disclosed",
  "Undisclosed",
];

type EeoCase = {
  name: string;
  label: string;
  base: string[];
  multiple?: boolean;
  type?: FormField["type"];
};

const EEO_CASES: EeoCase[] = [
  { name: "gender", label: "Gender", base: ["Male", "Female", "Non-binary"] },
  {
    name: "race",
    label: "Race/Ethnicity",
    base: [
      "Hispanic or Latino",
      "White (Not Hispanic or Latino)",
      "Black or African American (Not Hispanic or Latino)",
      "Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)",
      "Asian (Not Hispanic or Latino)",
      "American Indian or Alaska Native (Not Hispanic or Latino)",
      "Two or More Races (Not Hispanic or Latino)",
    ],
  },
  { name: "hispanic_latino", label: "Are you Hispanic/Latino?", base: YN },
  {
    name: "veteran",
    label: "Veteran Status",
    base: ["I identify as one or more of the classifications of protected veteran", "I am not a protected veteran"],
  },
  {
    name: "disability",
    label: "Disability Status",
    base: ["Yes, I have a disability, or have had one in the past", "No, I do not have a disability and have not had one in the past"],
  },
  { name: "sexual_orientation", label: "Sexual Orientation", base: ["Heterosexual", "Gay", "Lesbian", "Bisexual", "Queer", "Other"] },
  { name: "transgender", label: "Do you identify as transgender?", base: YN },
];

describe("decline is selected across every real option wording", () => {
  const declineProfile = confirmedProfile((p) => {
    p.eeo.gender.value = "decline";
    p.eeo.raceEthnicity.value = ["decline"];
    p.eeo.hispanicLatino.value = "decline";
    p.eeo.veteranStatus.value = "decline";
    p.eeo.disabilityStatus.value = "decline";
    p.eeo.sexualOrientation.value = "decline";
    p.eeo.transgender.value = "decline";
  });

  describe.each(EEO_CASES)("$name", (cs) => {
    for (const type of ["radio", "select"] as const) {
      for (const wording of DECLINE_WORDINGS) {
        it(`${type}: ${wording} (last)`, async () => {
          const f = mk(cs.label, { type, labels: [...cs.base, wording] });
          const r = await resolveField(f, ctxFor(declineProfile));
          expect(r.status, r.reason).toBe("answered");
          expect(r.source).toBe("profile");
          expect(chosenLabels(r, f)).toEqual([wording]);
        });
      }
      it(`${type}: decline option listed first`, async () => {
        const f = mk(cs.label, { type, labels: ["Decline To Self Identify", ...cs.base] });
        const r = await resolveField(f, ctxFor(declineProfile));
        expect(r.status, r.reason).toBe("answered");
        expect(chosenLabels(r, f)).toEqual(["Decline To Self Identify"]);
      });
    }
  });

  describe("race as a multi-select checkbox group", () => {
    const race = EEO_CASES[1]!;
    for (const wording of DECLINE_WORDINGS) {
      it(wording, async () => {
        const f = mk(race.label, { type: "checkbox", multiple: true, labels: [...race.base, wording] });
        const r = await resolveField(f, ctxFor(declineProfile));
        expect(r.status, r.reason).toBe("answered");
        expect(chosenLabels(r, f)).toEqual([wording]);
      });
    }
  });

  it("does not answer decline when the form offers no decline option", async () => {
    for (const cs of EEO_CASES) {
      const f = mk(cs.label, { labels: cs.base });
      const r = await resolveField(f, ctxFor(declineProfile));
      expect(r.status, cs.name).toBe("needs_input");
    }
  });

  it("does not pick decline when two options both read as decline", async () => {
    const f = mk("Gender", { labels: ["Male", "Female", "Prefer not to say", "Decline to answer"] });
    expect((await resolveField(f, ctxFor(declineProfile))).status).toBe("needs_input");
  });

  it("never selects decline for a confirmed non-decline value", async () => {
    const p = confirmedProfile((x) => {
      x.eeo.gender.value = "female";
    });
    const f = mk("Gender", { labels: ["Male", "Female", "Decline To Self Identify"] });
    expect(chosenLabels(await resolveField(f, ctxFor(p)), f)).toEqual(["Female"]);
  });
});

// ------------------------------------------------------------------ option mapping safety

describe("wrong-answer protection in option mapping", () => {
  it("non-protected veteran is not mapped to No on a plain 'served in the military' question", async () => {
    const f = mk("Have you served in the military?", { labels: YN });
    const r = await resolveField(f, ctxFor(confirmedProfile()));
    expect(r.status).toBe("needs_input");
    expect(r.answer).toBeUndefined();
  });

  it("non-protected veteran with Yes/No on 'Are you a veteran?' needs input", async () => {
    const f = mk("Are you a veteran?", { labels: YN });
    expect((await resolveField(f, ctxFor(confirmedProfile()))).status).toBe("needs_input");
  });

  it("non-protected veteran with Yes/No on 'Are you a protected veteran?' answers No", async () => {
    const f = mk("Are you a protected veteran?", { labels: YN });
    const r = await resolveField(f, ctxFor(confirmedProfile()));
    expect(chosenLabels(r, f)).toEqual(["No"]);
  });

  it("protected veteran answers Yes to 'Have you served in the military?'", async () => {
    const p = confirmedProfile((x) => {
      x.eeo.veteranStatus.value = "protected_veteran";
    });
    const f = mk("Have you served in the military?", { labels: YN });
    expect(chosenLabels(await resolveField(f, ctxFor(p)), f)).toEqual(["Yes"]);
  });

  it("veteran options without a 'protected veteran' reading need input", async () => {
    const f = mk("Veteran Status", { labels: ["Veteran", "Non-Veteran", "Prefer not to say"] });
    expect((await resolveField(f, ctxFor(confirmedProfile()))).status).toBe("needs_input");
  });

  it("ambiguous options (two options for one value) need input", async () => {
    const f = mk("Gender", { labels: ["Male", "Man", "Female"] });
    const p = confirmedProfile((x) => {
      x.eeo.gender.value = "male";
    });
    expect((await resolveField(f, ctxFor(p))).status).toBe("needs_input");
  });

  it("combined 'Asian or Pacific Islander' option is not taken as 'Asian'", async () => {
    const f = mk("Race", { labels: ["Asian or Pacific Islander", "White", "Black or African American", "Decline to self-identify"] });
    const p = confirmedProfile((x) => {
      x.eeo.raceEthnicity.value = ["asian"];
    });
    expect((await resolveField(f, ctxFor(p))).status).toBe("needs_input");
  });

  it("disability 'no' maps to the long OFCCP option", async () => {
    const long = "No, I do not have a disability and have not had one in the past";
    const f = mk("Disability Status", {
      labels: ["Yes, I have a disability, or have had one in the past", long, "I do not want to answer"],
    });
    const r = await resolveField(f, ctxFor(confirmedProfile()));
    expect(r.status, r.reason).toBe("answered");
    expect(chosenLabels(r, f)).toEqual([long]);
  });

  it("disability 'yes' maps to the 'Yes, I have a disability' option", async () => {
    const yes = "Yes, I have a disability, or have had one in the past";
    const f = mk("Disability Status", { labels: [yes, "No, I do not have a disability and have not had one in the past", "I do not want to answer"] });
    const p = confirmedProfile((x) => {
      x.eeo.disabilityStatus.value = "yes";
    });
    expect(chosenLabels(await resolveField(f, ctxFor(p)), f)).toEqual([yes]);
  });

  describe("gender substring trap", () => {
    const female = confirmedProfile((x) => {
      x.eeo.gender.value = "female";
    });
    const male = confirmedProfile((x) => {
      x.eeo.gender.value = "male";
    });

    it("female picks Female, not Male", async () => {
      for (const labels of [
        ["Male", "Female"],
        ["Female", "Male"],
        ["Man", "Woman", "Non-binary"],
        ["Male", "Female", "Decline To Self Identify"],
      ]) {
        const f = mk("Gender", { labels });
        const r = await resolveField(f, ctxFor(female));
        expect(r.status, labels.join()).toBe("answered");
        expect(chosenLabels(r, f)[0]).toMatch(/^(Female|Woman)$/);
      }
    });

    it("female with only a Male option needs input", async () => {
      const f = mk("Gender", { labels: ["Male", "Prefer not to say"] });
      expect((await resolveField(f, ctxFor(female))).status).toBe("needs_input");
    });

    it("male picks Male, not Female", async () => {
      const f = mk("Gender", { labels: ["Female", "Male"] });
      expect(chosenLabels(await resolveField(f, ctxFor(male)), f)).toEqual(["Male"]);
    });

    it("male with only a Female option needs input", async () => {
      const f = mk("Gender", { labels: ["Female", "Non-binary"] });
      expect((await resolveField(f, ctxFor(male))).status).toBe("needs_input");
    });
  });

  describe("race", () => {
    const raceProfile = (v: string[]) =>
      confirmedProfile((x) => {
        x.eeo.raceEthnicity.value = v as never;
      });
    const standard = EEO_CASES[1]!.base.concat("Decline To Self Identify");

    it("white maps to White, not Hispanic or Latino", async () => {
      const f = mk("Race", { labels: standard });
      expect(chosenLabels(await resolveField(f, ctxFor(raceProfile(["white"]))), f)).toEqual(["White (Not Hispanic or Latino)"]);
    });

    it("white maps to Caucasian when that is the wording", async () => {
      const f = mk("Race", { labels: ["Caucasian", "Black", "Asian", "Decline to self-identify"] });
      expect(chosenLabels(await resolveField(f, ctxFor(raceProfile(["white"]))), f)).toEqual(["Caucasian"]);
    });

    it("asian does not pick the Pacific Islander option and vice versa", async () => {
      const f = mk("Race", { labels: standard });
      expect(chosenLabels(await resolveField(f, ctxFor(raceProfile(["asian"]))), f)).toEqual(["Asian (Not Hispanic or Latino)"]);
      expect(chosenLabels(await resolveField(f, ctxFor(raceProfile(["native_hawaiian_pacific_islander"]))), f)).toEqual([
        "Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)",
      ]);
    });

    it("each stored race picks its own option", async () => {
      const f = mk("Race", { labels: standard });
      const expected: Record<string, string> = {
        american_indian_alaska_native: "American Indian or Alaska Native (Not Hispanic or Latino)",
        black_african_american: "Black or African American (Not Hispanic or Latino)",
        two_or_more: "Two or More Races (Not Hispanic or Latino)",
      };
      for (const [v, label] of Object.entries(expected)) {
        expect(chosenLabels(await resolveField(f, ctxFor(raceProfile([v]))), f), v).toEqual([label]);
      }
    });

    it("several races on a single-select question picks 'Two or more races'", async () => {
      const f = mk("Race", { labels: standard });
      const r = await resolveField(f, ctxFor(raceProfile(["asian", "white"])));
      expect(chosenLabels(r, f)).toEqual(["Two or More Races (Not Hispanic or Latino)"]);
    });

    it("several races on a single-select question without that option need input", async () => {
      const f = mk("Race", { labels: ["White", "Asian", "Black", "Decline to self-identify"] });
      expect((await resolveField(f, ctxFor(raceProfile(["asian", "white"])))).status).toBe("needs_input");
    });

    it("several races on a multi-select checkbox group select each", async () => {
      const f = mk("Race (select all that apply)", { type: "checkbox", multiple: true, labels: ["White", "Asian", "Black", "Decline"] });
      const r = await resolveField(f, ctxFor(raceProfile(["asian", "white"])));
      expect(r.status, r.reason).toBe("answered");
      expect(chosenLabels(r, f).sort()).toEqual(["Asian", "White"]);
    });
  });
});

// ------------------------------------------------------------------ answer bank

describe("Answer Bank", () => {
  it("is used when the profile cannot be mapped onto the options", async () => {
    const f = mk("Gender", { labels: ["Man", "Woman"] }); // no decline option for the stored "decline"
    const seen: string[] = [];
    const r = await resolveField(
      f,
      ctxFor(confirmedProfile(), {
        findBankAnswer: (q) => {
          seen.push(q);
          return { id: 7, text: "Woman" };
        },
      }),
    );
    expect(r.status).toBe("answered");
    expect(r.source).toBe("answer_bank");
    expect(chosenLabels(r, f)).toEqual(["Woman"]);
    expect(seen).toEqual(["gender"]);
  });

  it("is used when the profile has no confirmed value", async () => {
    const f = mk("Are you legally authorized to work in the United States?", { labels: YN });
    const r = await resolveField(f, ctxFor(emptyProfile(), { findBankAnswer: () => ({ id: 1, text: "Yes" }) }));
    expect(r.status).toBe("answered");
    expect(r.source).toBe("answer_bank");
    expect(chosenLabels(r, f)).toEqual(["Yes"]);
  });

  it("looks up by normalized question", async () => {
    const bank = new Map([["whats your favorite color", { id: 3, text: "Green" }]]);
    const r = await resolveField(mk("What’s your favorite color? *"), ctxFor(confirmedProfile(), { findBankAnswer: (q) => bank.get(q) ?? null }));
    expect(r.status).toBe("answered");
    expect(r.source).toBe("answer_bank");
    expect(r.answer).toEqual({ kind: "text", value: "Green" });
  });

  it("is used for a novel sensitive-looking question the user already answered", async () => {
    const r = await resolveField(
      mk("Describe your immigration history", { type: "textarea" }),
      ctxFor(confirmedProfile(), { findBankAnswer: () => ({ id: 2, text: "US citizen since birth." }) }),
    );
    expect(r.source).toBe("answer_bank");
  });

  it("does not override a profile answer", async () => {
    const f = mk("Email");
    const r = await resolveField(f, ctxFor(confirmedProfile(), { findBankAnswer: () => ({ id: 1, text: "other@example.com" }) }));
    expect(r.source).toBe("profile");
    expect(r.answer).toEqual({ kind: "text", value: "avery@example.com" });
  });

  it("an essay with a saved answer uses the bank, not a draft", async () => {
    const r = await resolveField(mk("Why do you want to work at Acme?", { type: "textarea" }), ctxFor(confirmedProfile(), { findBankAnswer: () => ({ id: 4, text: "Because." }) }));
    expect(r.source).toBe("answer_bank");
  });
});

// ------------------------------------------------------------------ work authorization

describe("work authorization by country", () => {
  it("is not answered for a country absent from the profile", async () => {
    for (const label of ["Are you legally authorized to work in Canada?", "Do you have the right to work in the UK?", "Are you authorized to work in Australia?"]) {
      const f = mk(label, { labels: YN });
      const r = await resolveField(f, ctxFor(confirmedProfile()));
      expect(r.status, label).toBe("needs_input");
    }
  });

  it("answers Yes for the United States", async () => {
    for (const label of ["Are you legally authorized to work in the United States?", "Are you authorized to work in the US?", "Are you legally eligible to work in the U.S.?"]) {
      const f = mk(label, { labels: YN });
      expect(chosenLabels(await resolveField(f, ctxFor(confirmedProfile())), f), label).toEqual(["Yes"]);
    }
  });

  it("answers per country when several are recorded", async () => {
    const p = confirmedProfile((x) => {
      x.workAuthorization.authorizedCountries.value = [
        { country: "US", authorized: true },
        { country: "CA", authorized: false },
      ];
    });
    const f = mk("Are you legally authorized to work in Canada?", { labels: YN });
    expect(chosenLabels(await resolveField(f, ctxFor(p)), f)).toEqual(["No"]);
  });

  it("uses the job country for questions that do not name one", async () => {
    const f = mk("Are you currently authorized to work in the country in which this job is located?", { labels: YN });
    const r = await resolveField(f, ctxFor(confirmedProfile(), { jobCountry: "CA" }));
    expect(r.status).toBe("needs_input");
  });
});

describe("sponsorship", () => {
  it("now=false, future=false answers No to all variants", async () => {
    for (const label of [
      "Do you require visa sponsorship?",
      "Will you now or in the future require sponsorship for employment visa status?",
      "Will you need visa sponsorship at any point in the future?",
    ]) {
      const f = mk(label, { labels: YN });
      expect(chosenLabels(await resolveField(f, ctxFor(confirmedProfile())), f), label).toEqual(["No"]);
    }
  });

  it("'now or future' answers Yes when sponsorship is needed now", async () => {
    const p = confirmedProfile((x) => {
      x.workAuthorization.requiresSponsorshipNow.value = true;
    });
    const f = mk("Will you now or in the future require sponsorship?", { labels: YN });
    expect(chosenLabels(await resolveField(f, ctxFor(p)), f)).toEqual(["Yes"]);
  });

  it("'now or future' needs input when only 'now' is confirmed false and 'future' is unconfirmed", async () => {
    const p = confirmedProfile((x) => {
      x.workAuthorization.requiresSponsorshipFuture.confirmedByUser = false;
    });
    const f = mk("Will you now or in the future require sponsorship?", { labels: YN });
    expect((await resolveField(f, ctxFor(p))).status).toBe("needs_input");
  });
});

// ------------------------------------------------------------------ criminal history

describe("criminal conviction", () => {
  const f = () => mk("Have you been convicted of a crime in the last 7 years?", { labels: YN });
  const withConviction = (v: boolean) =>
    confirmedProfile((x) => {
      x.screening.hasCriminalConviction.value = v;
    });

  it("true plus a time window needs input", async () => {
    expect((await resolveField(f(), ctxFor(withConviction(true)))).status).toBe("needs_input");
    for (const label of ["Have you been convicted of a felony within the past 5 years?", "Any convictions in the past 10 years?"]) {
      expect((await resolveField(mk(label, { labels: YN }), ctxFor(withConviction(true)))).status, label).toBe("needs_input");
    }
  });

  it("false plus a time window answers No", async () => {
    const field = f();
    expect(chosenLabels(await resolveField(field, ctxFor(withConviction(false))), field)).toEqual(["No"]);
  });

  it("true with no time window answers Yes", async () => {
    const field = mk("Have you ever been convicted of a felony?", { labels: YN });
    expect(chosenLabels(await resolveField(field, ctxFor(withConviction(true))), field)).toEqual(["Yes"]);
  });

  it("explanation: N/A when no conviction; needs input when yes without an explanation", async () => {
    const field = mk("If yes, please explain the conviction", { type: "textarea", required: false });
    const no = await resolveField(field, ctxFor(withConviction(false)));
    expect(no.status).toBe("answered");
    const yes = await resolveField(field, ctxFor(withConviction(true)));
    expect(yes.status).toBe("needs_input");
  });
});

// ------------------------------------------------------------------ attestations and signature

describe("attestations and signature", () => {
  const attest = () => mk("I certify that the information provided in this application is true and complete.", { type: "checkbox" });
  const sign = () => mk("Signature");
  const consent = (v: boolean | null, confirmedFlag = true) =>
    confirmedProfile((x) => {
      x.screening.acceptAttestations = { value: v, confirmedByUser: confirmedFlag };
    });

  it("checks the box only when acceptAttestations is confirmed true", async () => {
    const r = await resolveField(attest(), ctxFor(consent(true)));
    expect(r.status).toBe("answered");
    expect(r.answer).toEqual({ kind: "boolean", value: true });
    expect(r.source).toBe("profile");
  });

  it("needs input when consent is false, unconfirmed or missing", async () => {
    for (const p of [consent(false), consent(true, false), consent(null, false), emptyProfile()]) {
      for (const required of [true, false]) {
        const r = await resolveField({ ...attest(), required }, ctxFor(p));
        expect(r.status).toBe("needs_input");
        expect(r.answer).toBeUndefined();
      }
    }
  });

  it("signs with the confirmed legal name", async () => {
    const r = await resolveField(sign(), ctxFor(consent(true)));
    expect(r.status).toBe("answered");
    expect(r.answer).toEqual({ kind: "text", value: "Avery Quinn" });
  });

  it("does not sign without consent, or without a confirmed legal name", async () => {
    for (const p of [
      consent(false),
      consent(true, false),
      confirmedProfile((x) => {
        x.identity.legalLastName.confirmedByUser = false;
      }),
      confirmedProfile((x) => {
        x.identity.legalFirstName.value = null;
      }),
    ]) {
      expect((await resolveField(sign(), ctxFor(p))).status).toBe("needs_input");
    }
  });

  it("signature date follows the same consent rule", async () => {
    const field = mk("Signature Date", { type: "date" });
    const today = new Date("2026-03-04T12:00:00Z");
    const ok = await resolveField(field, ctxFor(consent(true), { today }));
    expect(ok.answer).toEqual({ kind: "text", value: "2026-03-04" });
    expect((await resolveField(field, ctxFor(consent(false), { today }))).status).toBe("needs_input");
  });
});

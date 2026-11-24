import { describe, expect, it } from "vitest";
import { emptyProfile, ProfileSchema, type Profile } from "../src/profile/schema.ts";
import {
  fitToField,
  matchBoolean,
  matchEnum,
  matchNumber,
  matchText,
  normalizeQuestion,
  totalExperienceYears,
  type FormField,
} from "../src/resolver/index.ts";

const opts = (labels: string[]) => labels.map((label, i) => ({ value: `v${i}`, label }));
const field = (labels?: string[], extra: Partial<FormField> = {}): FormField => ({
  id: "f",
  label: "Q",
  type: labels ? "radio" : "text",
  required: true,
  options: labels ? opts(labels) : undefined,
  ...extra,
});
const picked = (m: ReturnType<typeof matchText>) => (m.ok ? m.options.map((o) => o.label) : null);

describe("normalizeQuestion", () => {
  it.each([
    ["First Name*", "first name"],
    ["  Email   Address (required)  ", "email address"],
    ["Email (optional)", "email"],
    ["What’s your name?", "whats your name"],
    ["What's your name?", "whats your name"],
    ["Are you a U.S. citizen?", "are you a us citizen"],
    ["Are you authorized to work in the U.S.A.?", "are you authorized to work in the us"],
    ["Race/Ethnicity", "race/ethnicity"],
    ["Terms & Conditions", "terms and conditions"],
    ["Café résumé", "cafe resume"],
    ["LinkedIn URL:", "linkedin url"],
    ["", ""],
    ["***", ""],
  ])("%j -> %j", (input, out) => {
    expect(normalizeQuestion(input)).toBe(out);
  });

  it("is idempotent", () => {
    for (const s of ["What’s your name?", "Are you a U.S. citizen?*", "Café (optional)"]) {
      const once = normalizeQuestion(s);
      expect(normalizeQuestion(once)).toBe(once);
    }
  });

  it("treats curly and straight apostrophes the same", () => {
    expect(normalizeQuestion("I don’t wish to answer")).toBe(normalizeQuestion("I don't wish to answer"));
  });
});

describe("matchBoolean", () => {
  it("maps true/false onto Yes/No", () => {
    expect(picked(matchBoolean(true, field(["Yes", "No"])))).toEqual(["Yes"]);
    expect(picked(matchBoolean(false, field(["Yes", "No"])))).toEqual(["No"]);
    expect(picked(matchBoolean(false, field(["No", "Yes"])))).toEqual(["No"]);
  });
  it("handles descriptive yes/no labels", () => {
    const f = field(["Yes, I am authorized", "No, I am not authorized"]);
    expect(picked(matchBoolean(true, f))).toEqual(["Yes, I am authorized"]);
    expect(picked(matchBoolean(false, f))).toEqual(["No, I am not authorized"]);
  });
  it("handles True/False and Y/N", () => {
    expect(picked(matchBoolean(true, field(["True", "False"])))).toEqual(["True"]);
    expect(picked(matchBoolean(false, field(["Y", "N"])))).toEqual(["N"]);
  });
  it("does not treat 'Not sure' or 'Nothing' as No", () => {
    expect(matchBoolean(false, field(["Yes", "Nothing to report"])).ok).toBe(false);
  });
  it("fails on non yes/no options", () => {
    expect(matchBoolean(true, field(["Maybe", "Later"])).ok).toBe(false);
    expect(matchBoolean(true, field()).ok).toBe(false);
  });
  it("fails when more than one option matches", () => {
    expect(matchBoolean(true, field(["Yes", "Yes, with conditions", "No"])).ok).toBe(false);
  });
  it("ignores a decline option", () => {
    expect(picked(matchBoolean(true, field(["Yes", "No", "Prefer not to say"])))).toEqual(["Yes"]);
  });
});

describe("matchNumber", () => {
  const ranges = ["0-1 years", "1-3 years", "3-5 years", "5+ years"];
  it.each([
    [0, "0-1 years"],
    [2, "1-3 years"],
    [4, "3-5 years"],
    [5, "5+ years"],
    [12, "5+ years"],
  ])("%d years fits %j", (n, label) => {
    expect(picked(matchNumber(n, field(ranges)))).toEqual([label]);
  });

  it("prefers the range where the value is not the upper bound on overlapping bounds", () => {
    expect(picked(matchNumber(1, field(ranges)))).toEqual(["1-3 years"]);
    expect(picked(matchNumber(3, field(ranges)))).toEqual(["3-5 years"]);
  });

  it("handles 'Less than 1 year'", () => {
    const f = field(["Less than 1 year", "1-2 years", "3+ years"]);
    expect(picked(matchNumber(0, f))).toEqual(["Less than 1 year"]);
    expect(picked(matchNumber(1, f))).toEqual(["1-2 years"]);
    expect(picked(matchNumber(2, f))).toEqual(["1-2 years"]);
    expect(picked(matchNumber(7, f))).toEqual(["3+ years"]);
  });

  it("handles 'to' ranges, 'or more' and bare numbers", () => {
    const f = field(["0 to 2 years", "3 to 5 years", "6 or more years"]);
    expect(picked(matchNumber(1, f))).toEqual(["0 to 2 years"]);
    expect(picked(matchNumber(4, f))).toEqual(["3 to 5 years"]);
    expect(picked(matchNumber(9, f))).toEqual(["6 or more years"]);
    expect(picked(matchNumber(4, field(["1", "2", "3", "4", "5"])))).toEqual(["4"]);
  });

  it("fails when nothing fits", () => {
    expect(matchNumber(10, field(["0-1 years", "1-3 years"])).ok).toBe(false);
    expect(matchNumber(2, field(["Yes", "No"])).ok).toBe(false);
    expect(matchNumber(2, field()).ok).toBe(false);
  });

  it("fails when several non-overlapping-bound options still fit", () => {
    expect(matchNumber(3, field(["1-5 years", "2-6 years"])).ok).toBe(false);
  });
});

describe("matchText", () => {
  it("matches exactly on label or value, ignoring case and punctuation", () => {
    expect(picked(matchText("LinkedIn", field(["Referral", "LinkedIn", "Other"])))).toEqual(["LinkedIn"]);
    expect(picked(matchText("linkedin!", field(["Referral", "LinkedIn"])))).toEqual(["LinkedIn"]);
    const f: FormField = { ...field(), options: [{ value: "li", label: "LinkedIn Jobs" }, { value: "ref", label: "Referral" }] };
    expect(picked(matchText("li", f))).toEqual(["LinkedIn Jobs"]);
  });

  it("matches by containment in either direction", () => {
    expect(picked(matchText("LinkedIn", field(["LinkedIn Jobs", "Indeed", "Company site"])))).toEqual(["LinkedIn Jobs"]);
    expect(picked(matchText("Company careers site", field(["Company site", "Indeed"])))).toEqual(["Company site"]); // via token overlap
    expect(picked(matchText("Bachelor's Degree in Science", field(["Bachelor's Degree", "Master's Degree"])))).toEqual(["Bachelor's Degree"]);
  });

  it("falls back to token overlap", () => {
    expect(picked(matchText("Doctorate (PhD)", field(["Doctor of Philosophy (PhD)", "Master's", "Bachelor's"])))).toEqual(["Doctor of Philosophy (PhD)"]);
    expect(picked(matchText("Software Engineering", field(["Computer Science", "Software Engineer", "Math"])))).toEqual(["Software Engineer"]);
  });

  it("rejects ties and weak overlaps", () => {
    expect(matchText("Computer", field(["Computer Science", "Computer Engineering"])).ok).toBe(false);
    expect(matchText("Biology", field(["Computer Science", "Math"])).ok).toBe(false);
  });

  it("uses 'Other' only when allowOther is set", () => {
    const f = field(["Indeed", "Glassdoor", "Other"]);
    expect(matchText("A podcast", f).ok).toBe(false);
    expect(picked(matchText("A podcast", f, { allowOther: true }))).toEqual(["Other"]);
    expect(picked(matchText("Indeed", f, { allowOther: true }))).toEqual(["Indeed"]);
  });

  it("allowOther does not guess when there are two Other options", () => {
    expect(matchText("A podcast", field(["Other", "Other (please specify)"]), { allowOther: true }).ok).toBe(false);
  });

  it("fails on empty options", () => {
    expect(matchText("x", field()).ok).toBe(false);
  });
});

describe("matchEnum", () => {
  it("rejects unknown enums and values", () => {
    expect(matchEnum("nope", "x", field(["A"]), "Q").ok).toBe(false);
    expect(matchEnum("gender", "alien", field(["Male"]), "Q").ok).toBe(false);
  });
  it("maps gender", () => {
    const f = field(["Male", "Female", "Non-binary", "Prefer not to say"]);
    expect(picked(matchEnum("gender", "female", f, "Gender"))).toEqual(["Female"]);
    expect(picked(matchEnum("gender", "male", f, "Gender"))).toEqual(["Male"]);
    expect(picked(matchEnum("gender", "non_binary", f, "Gender"))).toEqual(["Non-binary"]);
    expect(picked(matchEnum("gender", "decline", f, "Gender"))).toEqual(["Prefer not to say"]);
  });
  it("maps LGBTQ yes/no on an orientation question", () => {
    const f = field(["Yes", "No", "Decline to answer"]);
    expect(picked(matchEnum("sexual_orientation", "heterosexual", f, "Do you identify as LGBTQ+?"))).toEqual(["No"]);
    expect(picked(matchEnum("sexual_orientation", "gay", f, "Do you identify as LGBTQ+?"))).toEqual(["Yes"]);
    expect(picked(matchEnum("sexual_orientation", "decline", f, "Do you identify as LGBTQ+?"))).toEqual(["Decline to answer"]);
  });
  it("does not map heterosexual to a bare No outside an LGBTQ question", () => {
    expect(matchEnum("sexual_orientation", "heterosexual", field(["Yes", "No"]), "Sexual orientation").ok).toBe(false);
  });
  it("maps veteran statuses", () => {
    const f = field(["I identify as one or more of the classifications of protected veteran", "I am not a protected veteran", "I don't wish to answer"]);
    expect(picked(matchEnum("veteran", "protected_veteran", f, "Veteran Status"))?.[0]).toMatch(/^I identify as one or more/);
    expect(picked(matchEnum("veteran", "not_protected_veteran", f, "Veteran Status"))).toEqual(["I am not a protected veteran"]);
    expect(picked(matchEnum("veteran", "decline", f, "Veteran Status"))).toEqual(["I don't wish to answer"]);
  });
  it("does not map protected_veteran onto a 'not a protected veteran' option", () => {
    expect(matchEnum("veteran", "protected_veteran", field(["I am not a protected veteran", "Decline"]), "Veteran Status").ok).toBe(false);
  });
  it("several values on a multi-select each map", () => {
    const f = field(["White", "Asian", "Black or African American"], { type: "checkbox", multiple: true });
    const m = matchEnum("race", ["white", "asian"], f, "Race");
    expect(picked(m)).toEqual(["White", "Asian"]);
  });
  it("several values on a single-select fail unless 'Two or more'", () => {
    expect(matchEnum("race", ["white", "asian"], field(["White", "Asian"]), "Race").ok).toBe(false);
    expect(picked(matchEnum("race", ["white", "asian"], field(["White", "Asian", "Two or more races"]), "Race"))).toEqual(["Two or more races"]);
    expect(matchEnum("gender", ["male", "female"], field(["Male", "Female"]), "Gender").ok).toBe(false);
  });
  it("fails when no option matches", () => {
    expect(matchEnum("gender", "female", field(["Male", "Non-binary"]), "Gender").ok).toBe(false);
  });
});

describe("fitToField", () => {
  it("text: stringifies values", () => {
    expect(fitToField("Avery", field(), "first_name").answer).toEqual({ kind: "text", value: "Avery" });
    expect(fitToField(6, field(), "skill_years").answer).toEqual({ kind: "text", value: "6" });
    expect(fitToField(true, field(), "x").answer).toEqual({ kind: "text", value: "Yes" });
    expect(fitToField(false, field(), "x").answer).toEqual({ kind: "text", value: "No" });
    expect(fitToField(["a", "b"], field(), "x").answer).toEqual({ kind: "text", value: "a, b" });
  });
  it("textarea: same as text", () => {
    expect(fitToField("Hello", field(undefined, { type: "textarea" }), "x").answer).toEqual({ kind: "text", value: "Hello" });
  });
  it("date: passes ISO strings through", () => {
    expect(fitToField("2026-12-01", field(undefined, { type: "date" }), "start_date").answer).toEqual({ kind: "text", value: "2026-12-01" });
  });
  it("checkbox without options: boolean only", () => {
    const f = field(undefined, { type: "checkbox" });
    expect(fitToField(true, f, "x").answer).toEqual({ kind: "boolean", value: true });
    expect(fitToField(false, f, "x").answer).toEqual({ kind: "boolean", value: false });
    expect(fitToField("Yes", f, "x").answer).toBeUndefined();
    expect(fitToField(3, f, "x").answer).toBeUndefined();
  });
  it("select with options: booleans, numbers, text and arrays", () => {
    expect(fitToField(true, field(["Yes", "No"]), "x").answer).toEqual({ kind: "option", values: ["v0"] });
    expect(fitToField(4, field(["0-1", "3-5", "5+"]), "x").answer).toEqual({ kind: "option", values: ["v1"] });
    expect(fitToField("LinkedIn", field(["Indeed", "LinkedIn"]), "how_did_you_hear").answer).toEqual({ kind: "option", values: ["v1"] });
    expect(fitToField(["Indeed", "LinkedIn"], field(["Indeed", "LinkedIn"], { type: "checkbox", multiple: true }), "x").answer).toEqual({ kind: "option", values: ["v0", "v1"] });
    expect(fitToField(["Indeed", "Nope"], field(["Indeed", "LinkedIn"]), "x").answer).toBeUndefined();
  });
  it("only how_did_you_hear may fall back to 'Other'", () => {
    const f = field(["Indeed", "Other"]);
    expect(fitToField("A podcast", f, "how_did_you_hear").answer).toEqual({ kind: "option", values: ["v1"] });
    expect(fitToField("A podcast", f, "school").answer).toBeUndefined();
  });
  it("uses enum rules when an enum key is given", () => {
    expect(fitToField("female", field(["Male", "Female"]), "gender", "gender").answer).toEqual({ kind: "option", values: ["v1"] });
  });
  it("degree levels use text matching, not enum rules", () => {
    const f = field(["High School", "Bachelor's Degree", "Master's Degree"]);
    expect(fitToField("Bachelor's Degree", f, "highest_education", "degree_level").answer).toEqual({ kind: "option", values: ["v1"] });
  });
  it("returns a reason when it cannot fit", () => {
    const r = fitToField("x", field(["A", "B"]), "k");
    expect(r.answer).toBeUndefined();
    expect(r.reason.length).toBeGreaterThan(0);
  });
});

describe("totalExperienceYears", () => {
  const today = new Date(2026, 5, 15); // June 2026
  const job = (startDate: string | null, endDate: string | null, extra: Partial<Profile["experience"][number]> = {}) => ({
    id: Math.random().toString(36).slice(2),
    company: "Co",
    title: "Eng",
    location: "",
    startDate,
    endDate,
    current: false,
    bullets: [],
    confirmedByUser: true,
    ...extra,
  });
  const withJobs = (jobs: ReturnType<typeof job>[]) => ProfileSchema.parse({ experience: jobs });

  it("is 0 with no jobs", () => {
    expect(totalExperienceYears(emptyProfile(), today)).toBe(0);
  });
  it("counts inclusive months of one job", () => {
    // 2020-01 to 2022-12 = 36 months
    expect(totalExperienceYears(withJobs([job("2020-01", "2022-12")]), today)).toBe(3);
    // 2020-01 to 2021-11 = 23 months
    expect(totalExperienceYears(withJobs([job("2020-01", "2021-11")]), today)).toBe(1);
  });
  it("merges overlapping jobs", () => {
    const p = withJobs([job("2018-01", "2019-12"), job("2019-01", "2020-12")]);
    expect(totalExperienceYears(p, today)).toBe(3); // 2018-01..2020-12 = 36 months
  });
  it("merges a job fully contained in another", () => {
    const p = withJobs([job("2018-01", "2022-12"), job("2019-06", "2020-06")]);
    expect(totalExperienceYears(p, today)).toBe(5);
  });
  it("does not count gaps", () => {
    const p = withJobs([job("2010-01", "2010-12"), job("2015-01", "2015-12")]);
    expect(totalExperienceYears(p, today)).toBe(2);
  });
  it("counts a current job up to today", () => {
    // 2020-06 .. 2026-06 inclusive = 73 months => 6 years
    expect(totalExperienceYears(withJobs([job("2020-06", null, { current: true })]), today)).toBe(6);
    expect(totalExperienceYears(withJobs([job("2023-07", null, { current: true })]), today)).toBe(3);
  });
  it("treats a missing end date as ongoing", () => {
    expect(totalExperienceYears(withJobs([job("2024-06", null)]), today)).toBe(2);
  });
  it("ignores unconfirmed jobs, jobs without a start date and inverted ranges", () => {
    const p = withJobs([
      job("2000-01", "2020-12", { confirmedByUser: false }),
      job(null, "2020-12"),
      job("2022-01", "2021-01"),
      job("2021-01", "2021-12"),
    ]);
    expect(totalExperienceYears(p, today)).toBe(1);
  });
  it("a current job overlapping a past one is merged", () => {
    const p = withJobs([job("2020-01", "2022-12"), job("2022-06", null, { current: true })]);
    // 2020-01 .. 2026-06 = 78 months => 6
    expect(totalExperienceYears(p, today)).toBe(6);
  });
});

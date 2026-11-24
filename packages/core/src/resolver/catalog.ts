import type { Education, Experience, Field, Profile } from "../profile/schema.ts";
import type { FormField } from "./types.ts";

/**
 * Categories drive the hard rules:
 *  - legal / demographic: answered only from values the user confirmed (or
 *    the Answer Bank, which is the user's own words). The LLM may classify
 *    these questions; it may never supply the answer.
 *  - generated: drafted per job by the LLM from profile facts (cover letter).
 *  - standard / document: answered from the profile or uploaded documents.
 */
export type Category = "standard" | "document" | "legal" | "demographic" | "generated";

/** A semantic answer from the profile, before it is fitted to a specific field. */
export type ProfileAnswer =
  | { kind: "value"; value: string | number | boolean | string[]; enumKey?: string }
  | { kind: "file"; document: "resume" | "transcript" }
  | { kind: "generate" }
  | { kind: "missing"; reason: string };

export type AnswerContext = {
  company: string;
  /** ISO country code of the posting, when known. Defaults to US. */
  jobCountry?: string;
  today?: Date;
};

export type CatalogEntry = {
  key: string;
  category: Category;
  /** Matched against the normalized label. First entry whose pattern matches wins. */
  patterns: RegExp[];
  /** Restrict to these field types (e.g. resume → file). */
  types?: FormField["type"][];
  /** Exclude when the label also matches these. */
  not?: RegExp[];
  /** Extra condition on the field (e.g. its options). */
  when?: (field: FormField) => boolean;
  answer: (p: Profile, field: FormField, ctx: AnswerContext, label: string) => ProfileAnswer;
};

// ------------------------------------------------------------------ helpers

const missing = (reason: string): ProfileAnswer => ({ kind: "missing", reason });
const val = (value: string | number | boolean | string[], enumKey?: string): ProfileAnswer => ({ kind: "value", value, enumKey });

/** Only confirmed, non-empty values count. */
function confirmed<T>(f: Field<T>, what: string): ProfileAnswer | { ok: T } {
  if (!f.confirmedByUser || f.value === null || f.value === "" || (Array.isArray(f.value) && f.value.length === 0)) {
    return missing(`${what} isn’t confirmed in your profile`);
  }
  return { ok: f.value };
}
function isOk<T>(r: ProfileAnswer | { ok: T }): r is { ok: T } {
  return "ok" in r;
}
function fromField<T extends string | number | boolean | string[]>(f: Field<T>, what: string, enumKey?: string): ProfileAnswer {
  const r = confirmed(f, what);
  return isOk(r) ? val(r.ok, enumKey) : r;
}

function latestEducation(p: Profile): Education | null {
  const eds = p.education.filter((e) => e.confirmedByUser);
  if (!eds.length) return null;
  return [...eds].sort((a, b) => (b.graduationDate ?? "9999").localeCompare(a.graduationDate ?? "9999"))[0]!;
}
function currentJob(p: Profile): Experience | null {
  const jobs = p.experience.filter((e) => e.confirmedByUser);
  return jobs.find((j) => j.current) ?? [...jobs].sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))[0] ?? null;
}

const DEGREE_RANK = ["high_school", "certificate", "bootcamp", "associate", "bachelor", "master", "mba", "jd", "md", "phd"];
export const DEGREE_LABEL: Record<string, string> = {
  high_school: "High School Diploma",
  certificate: "Certificate",
  bootcamp: "Bootcamp",
  associate: "Associate's Degree",
  bachelor: "Bachelor's Degree",
  master: "Master's Degree",
  mba: "MBA",
  jd: "Juris Doctor (JD)",
  md: "Doctor of Medicine (MD)",
  phd: "Doctorate (PhD)",
  other: "Other",
};

/** Months of experience across confirmed jobs, merging overlaps. */
export function totalExperienceYears(p: Profile, today = new Date()): number {
  const toIdx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
  const nowIdx = today.getFullYear() * 12 + today.getMonth();
  const spans = p.experience
    .filter((e) => e.confirmedByUser && e.startDate)
    .map((e) => [toIdx(e.startDate!), e.current || !e.endDate ? nowIdx : toIdx(e.endDate)] as const)
    .filter(([s, e]) => e >= s)
    .sort((a, b) => a[0] - b[0]);
  let months = 0;
  let curS = -1;
  let curE = -1;
  for (const [s, e] of spans) {
    if (s > curE) {
      if (curE >= 0) months += curE - curS + 1;
      curS = s;
      curE = e;
    } else curE = Math.max(curE, e);
  }
  if (curE >= 0) months += curE - curS + 1;
  return Math.floor(months / 12);
}

const COUNTRY_IN_LABEL: [RegExp, string][] = [
  [/\b(canada|canadian)\b/, "CA"],
  [/\b(uk|united kingdom|britain|great britain|england)\b/, "GB"],
  [/\b(australia)\b/, "AU"],
  [/\b(india)\b/, "IN"],
  [/\b(germany)\b/, "DE"],
  [/\b(ireland)\b/, "IE"],
  [/\b(us|usa|united states|america)\b/, "US"],
];

function countryFromLabel(label: string, ctx: AnswerContext): string {
  for (const [re, code] of COUNTRY_IN_LABEL) if (re.test(label)) return code;
  return ctx.jobCountry ?? "US";
}

const sameCompany = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(inc|llc|ltd|corp|corporation|co)$/, "");
  return n(a) !== "" && n(a) === n(b);
};

function isYesNo(field: FormField) {
  return (field.type === "radio" || field.type === "select") && (field.options?.length ?? 0) <= 4 && (field.options ?? []).some((o) => /^(yes|no)\b/i.test(o.label.trim()));
}

function formatMonth(m: string, field: FormField): string {
  if (field.type === "date") return `${m}-01`;
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * "Authorized to work in X?" from the confirmed country list. "...without
 * sponsorship?" additionally requires a confirmed "no sponsorship needed now".
 */
function workAuthorized(p: Profile, ctx: AnswerContext, label: string): ProfileAnswer {
  const list = confirmed(p.workAuthorization.authorizedCountries, "Work authorization");
  if (!isOk(list)) return list;
  const code = countryFromLabel(label, ctx);
  const entry = list.ok.find((c) => c.country.toUpperCase() === code);
  if (!entry) return missing(`Work authorization for ${code} isn’t in your profile`);
  if (/\bwithout\b.*\bsponsor/.test(label)) {
    const now = confirmed(p.workAuthorization.requiresSponsorshipNow, "Sponsorship now");
    if (!isOk(now)) return now;
    return val(entry.authorized && !now.ok);
  }
  return val(entry.authorized);
}

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// ------------------------------------------------------------------ catalog

/**
 * Ordered: more specific entries come first (e.g. "years of experience with
 * Python" before "years of experience", "preferred name" before "name").
 */
export const CATALOG: CatalogEntry[] = [
  // ---- sensitive questions that the profile never answers
  {
    key: "ssn",
    category: "legal",
    patterns: [/\b(social security|ssn)\b/],
    answer: () => missing("Autoply never enters a Social Security number"),
  },
  {
    key: "date_of_birth",
    category: "legal",
    patterns: [/\b(date of birth|birth date|birthdate|dob)\b/],
    answer: () => missing("Autoply never enters your date of birth"),
  },
  {
    key: "accommodation",
    category: "legal",
    patterns: [/\baccommodation/],
    answer: () => missing("Accommodation requests are always yours to answer"),
  },

  // ---- attestations
  {
    key: "signature_date",
    category: "legal",
    // A bare "Date" on application forms is the signature date (e.g. the CC-305 disability form).
    patterns: [/^signature date$/, /^(today s|todays|current) date$/, /^date signed$/, /^date$/],
    answer: (p, field, ctx) => {
      const ok = confirmed(p.screening.acceptAttestations, "Consent to sign for you");
      if (!isOk(ok) || ok.ok !== true) return missing("You haven’t allowed Autoply to sign for you");
      const d = ctx.today ?? new Date();
      return val(field.type === "date" ? d.toISOString().slice(0, 10) : d.toLocaleDateString("en-US"));
    },
  },
  {
    key: "signature",
    category: "legal",
    patterns: [/\bsignature\b/, /\btype your (full |legal )?name\b.*\b(sign|signature)/, /\bto sign\b/],
    answer: (p) => {
      const ok = confirmed(p.screening.acceptAttestations, "Consent to sign for you");
      if (!isOk(ok) || ok.ok !== true) return missing("You haven’t allowed Autoply to sign for you");
      const first = confirmed(p.identity.legalFirstName, "Legal first name");
      const last = confirmed(p.identity.legalLastName, "Legal last name");
      if (!isOk(first) || !isOk(last)) return missing("Legal name isn’t confirmed");
      return val(`${first.ok} ${last.ok}`);
    },
  },
  {
    key: "attestation",
    category: "legal",
    patterns: [
      /\bi (certify|attest|acknowledge|affirm|declare|understand|agree|consent|confirm that)\b/,
      /\bby (checking|submitting|clicking)\b/,
      /\b(true|accurate) and (complete|correct)\b/,
      /\bfalsification\b/,
      /\b(privacy (policy|notice)|terms (and|of) (conditions|service|use))\b/,
      /\bprocessing of my personal (data|information)\b/,
    ],
    not: [/\b18\b/, /\bbackground check\b/, /\bdrug\b/],
    types: ["checkbox", "radio", "select"],
    answer: (p) => {
      const ok = confirmed(p.screening.acceptAttestations, "Consent to accept attestations");
      if (!isOk(ok)) return ok;
      return ok.ok ? val(true) : missing("You asked to answer attestations yourself");
    },
  },

  // ---- EEO / voluntary self-identification
  {
    key: "transgender",
    category: "demographic",
    patterns: [/\btrans(gender)?\b/, /\bgender non ?conforming\b/],
    answer: (p) => fromField(p.eeo.transgender, "Transgender identity", "yes_no_decline"),
  },
  {
    key: "sexual_orientation",
    category: "demographic",
    patterns: [/\bsexual orientation\b/, /\blgbtq/, /\blgbt\b/],
    answer: (p) => fromField(p.eeo.sexualOrientation, "Sexual orientation", "sexual_orientation"),
  },
  {
    key: "hispanic_latino",
    category: "demographic",
    patterns: [/\b(hispanic|latino|latina|latinx|latin x|latino a x)\b/],
    not: [/\brace\b.*\bethnicity\b/],
    answer: (p) => fromField(p.eeo.hispanicLatino, "Hispanic/Latino", "yes_no_decline"),
  },
  {
    key: "race",
    category: "demographic",
    patterns: [/\brace\b/, /\bracial\b/, /\bethnicity\b/, /\bethnic (background|origin|group)\b/],
    answer: (p) => fromField(p.eeo.raceEthnicity, "Race/ethnicity", "race"),
  },
  {
    key: "veteran",
    category: "demographic",
    patterns: [/\bveteran\b/, /\bserved in the (military|armed forces|us military)\b/, /\bmilitary\b.*\b(status|service)\b/],
    answer: (p) => fromField(p.eeo.veteranStatus, "Veteran status", "veteran"),
  },
  {
    key: "disability",
    category: "demographic",
    patterns: [/\bdisabilit(y|ies)\b/, /\bdisabled\b/],
    answer: (p) => fromField(p.eeo.disabilityStatus, "Disability status", "yes_no_decline"),
  },
  {
    key: "gender",
    category: "demographic",
    patterns: [/^gender\b/, /\bgender identity\b/, /\byour gender\b/, /^sex$/, /\bgender (do you|most)\b/, /\bwhich gender\b/],
    answer: (p) => fromField(p.eeo.gender, "Gender", "gender"),
  },
  {
    key: "pronouns",
    category: "standard",
    patterns: [/\bpronouns?\b/],
    answer: (p) => fromField(p.identity.pronouns, "Pronouns"),
  },

  // ---- work authorization
  {
    key: "visa_type",
    category: "legal",
    patterns: [/\bvisa (status|type)\b/, /\bimmigration status\b/, /\bwhat type\b.*\bvisa\b|\bvisa\b.*\bwhat type\b/, /\bwork authori[sz]ation status\b/],
    // "What visa type will you need?" asks about a future visa, not the current status.
    not: [/\bsponsor/, /\b(will|would) (you )?(need|require)\b/],
    when: (f) => !(f.options?.length && f.options.every((o) => /\bauthori[sz]ed\b/i.test(o.label))),
    answer: (p, field) => {
      const citizen = p.workAuthorization.citizenship;
      if (field.options?.length && citizen.confirmedByUser && citizen.value?.some((c) => /^(us|usa|united states)$/i.test(c))) {
        return val("U.S. Citizen");
      }
      return fromField(p.workAuthorization.visaType, "Visa status");
    },
  },
  {
    key: "work_authorized",
    category: "legal",
    patterns: [
      /\b(legally |currently )?(authori[sz]ed|eligible|permitted)\b.*\bwork\b/,
      /\bright to work\b/,
      /\bwork authori[sz]ation\b/,
      /\bauthori[sz]ation to work\b/,
      /\beligibility to work\b/,
    ],
    // Sponsorship questions are matched first unless they ask about being authorized *without* sponsorship.
    not: [/\bsponsor/],
    answer: (p, _field, ctx, label) => workAuthorized(p, ctx, label),
  },
  {
    key: "work_authorized",
    category: "legal",
    patterns: [/\b(authori[sz]ed|eligible|permitted|right)\b.*\bwork\b.*\bwithout\b.*\bsponsor/],
    answer: (p, _field, ctx, label) => workAuthorized(p, ctx, label),
  },

  {
    key: "sponsorship_any",
    category: "legal",
    patterns: [
      /\bnow\b.*\bfuture\b.*\bsponsor/,
      /\bsponsor.*\bnow\b.*\bfuture\b/,
      /\bnow or (will you )?(ever|in the future)\b.*sponsor/,
      /\bsponsor.*\bnow or in the future\b/,
      /\bnow,? or will you (ever|in the future)\b.*\bsponsor/,
      // "Will you require sponsorship?" doesn't say "now": answering it from "now" alone could
      // say "No" for someone who needs sponsorship later. Treat it as now-or-future.
      /^will you (require|need)\b(?!.*\b(future|later|at any point|after)\b).*\bsponsor/,
    ],
    not: [/\bcurrently\b/],
    answer: (p) => {
      const now = confirmed(p.workAuthorization.requiresSponsorshipNow, "Sponsorship now");
      if (!isOk(now)) return now;
      if (now.ok) return val(true);
      const future = confirmed(p.workAuthorization.requiresSponsorshipFuture, "Sponsorship in the future");
      return isOk(future) ? val(future.ok) : future;
    },
  },
  {
    key: "sponsorship_future",
    category: "legal",
    patterns: [/\b(in the future|future|at any point|later)\b.*\bsponsor/, /\bsponsor.*\b(in the future|after (opt|cpt))\b/],
    answer: (p) => fromField(p.workAuthorization.requiresSponsorshipFuture, "Sponsorship in the future"),
  },
  {
    key: "sponsorship_now",
    category: "legal",
    patterns: [/\bsponsor(ship)?\b/],
    not: [/\bauthoriz(ed|ation) status\b/],
    answer: (p) => fromField(p.workAuthorization.requiresSponsorshipNow, "Sponsorship now"),
  },
  {
    key: "citizenship",
    category: "legal",
    patterns: [/\bcitizen(ship)?\b/],
    answer: (p, field, _ctx, label) => {
      const c = confirmed(p.workAuthorization.citizenship, "Citizenship");
      if (!isOk(c)) return c;
      const isUs = c.ok.some((x) => /^(us|usa|united states|u s)$/i.test(x.trim()));
      if (isYesNo(field) || field.type === "checkbox") {
        if (/\bpermanent resident\b|\bgreen card\b/.test(label)) {
          if (isUs) return val(true);
          const visa = p.workAuthorization.visaType;
          if (visa.confirmedByUser && visa.value && /permanent|green card/i.test(visa.value)) return val(true);
          return missing("Permanent residency isn’t recorded in your profile");
        }
        return val(isUs);
      }
      return val(c.ok.join(", "));
    },
  },
  {
    key: "security_clearance",
    category: "legal",
    patterns: [/\b(security )?clearance\b/],
    not: [/\b(able|eligible) to (obtain|get)\b/],
    answer: (p, field) => {
      const c = confirmed(p.workAuthorization.securityClearance, "Security clearance");
      if (!isOk(c)) return c;
      if (isYesNo(field)) return val(c.ok !== "none");
      const labels: Record<string, string> = {
        none: "None",
        public_trust: "Public Trust",
        confidential: "Confidential",
        secret: "Secret",
        top_secret: "Top Secret",
        ts_sci: "TS/SCI",
      };
      return val(labels[c.ok] ?? c.ok);
    },
  },
  // ---- screening
  {
    key: "over_18",
    category: "legal",
    patterns: [/\b18\b/, /\blegal (working )?age\b/, /\bage of majority\b/],
    answer: (p) => fromField(p.screening.over18, "Age (18 or older)"),
  },
  {
    key: "criminal_conviction_explanation",
    category: "legal",
    patterns: [/\b(explain|describe|details)\b.*\bconvict/, /\bif yes\b.*\b(explain|describe)\b.*\b(conviction|offense)\b/, /\bexplain the conviction\b/],
    answer: (p) => {
      const c = confirmed(p.screening.hasCriminalConviction, "Criminal history");
      if (!isOk(c)) return c;
      if (!c.ok) return val("N/A");
      return fromField(p.screening.criminalConvictionExplanation, "Conviction explanation");
    },
  },
  {
    key: "criminal_conviction",
    category: "legal",
    patterns: [/\bconvict(ed|ion|ions)\b/, /\bfelony\b/, /\bcriminal (offense|record|history)\b/, /\bpled guilty\b/, /\bno contest\b/],
    answer: (p, _f, _c, label) => {
      const c = confirmed(p.screening.hasCriminalConviction, "Criminal history");
      if (!isOk(c)) return c;
      // "Ever convicted: no" answers any time window; "yes" doesn't tell us about a specific window.
      if (c.ok && /\b(last|past) \d+ years\b|\bwithin\b/.test(label)) return missing("Your profile doesn’t say when the conviction was");
      return val(c.ok);
    },
  },
  {
    key: "background_check",
    category: "legal",
    patterns: [/\bbackground (check|screening|investigation)\b/],
    answer: (p) => fromField(p.screening.willingBackgroundCheck, "Background check consent"),
  },
  {
    key: "drug_test",
    category: "legal",
    patterns: [/\bdrug (test|screen|screening)\b/],
    answer: (p) => fromField(p.screening.willingDrugTest, "Drug test consent"),
  },
  {
    key: "non_compete",
    category: "legal",
    patterns: [/\bnon ?compete\b/, /\bnon ?solicitation\b/, /\bagreements?\b.*\b(restrict|prevent|limit)\b/],
    answer: (p) => fromField(p.screening.hasNonCompete, "Non-compete"),
  },
  {
    key: "relatives_employed",
    category: "legal",
    patterns: [/\b(relative|relatives|family member|related to)\b/],
    answer: (p, _f, ctx) => {
      const r = p.screening.relativesAtCompanies;
      if (!r.confirmedByUser || r.value === null) return missing("Relatives at companies isn’t confirmed");
      return val(r.value.some((c) => sameCompany(c, ctx.company)));
    },
  },
  {
    key: "previously_employed",
    category: "legal",
    patterns: [
      /\b(previously|ever) (been )?(employed|worked)\b/,
      /\bworked (for|at) (this company|us|[a-z0-9 ]+) (before|as an)\b/,
      /\bcurrent or former employee\b/,
      /\bhave you (ever )?worked (for|at)\b/,
    ],
    answer: (p, _f, ctx) => {
      const prev = p.screening.previousEmployers;
      if (!prev.confirmedByUser || prev.value === null) return missing("Previous employers isn’t confirmed");
      const worked = prev.value.some((c) => sameCompany(c, ctx.company)) || p.experience.some((e) => e.confirmedByUser && sameCompany(e.company, ctx.company));
      return val(worked);
    },
  },

  // ---- documents
  { key: "resume", category: "document", patterns: [/\b(resume|cv|curriculum vitae)\b/], types: ["file"], answer: () => ({ kind: "file", document: "resume" }) },
  {
    key: "transcript",
    category: "document",
    patterns: [/\btranscripts?\b/],
    types: ["file"],
    answer: () => ({ kind: "file", document: "transcript" }),
  },
  {
    key: "cover_letter",
    category: "generated",
    patterns: [/\bcover letter\b/],
    types: ["file", "textarea", "text"],
    answer: () => ({ kind: "generate" }),
  },

  // ---- experience
  {
    key: "skill_years",
    category: "standard",
    patterns: [/\byears\b.*\b(experience|exp)\b.*\b(with|in|using|of)\b\s*\S+/, /\byears of\b\s+\S+.*\bexperience\b/, /\b(with|in)\b\s+\S+.*\byears\b/],
    not: [
      /\byears of (work|professional|relevant|industry|total|related|prior|paid|full time|post graduate|overall) (work )?experience\b(?!.*\b(with|using|in|working)\b)/,
      /^how many years of experience do you have$/,
      /^years of (professional )?experience$/,
    ],
    answer: (p, _f, _c, label) => {
      const years = p.screening.skillYears;
      if (!years.confirmedByUser || !years.value?.length) return missing("Years of experience per skill isn’t in your profile");
      const hit = years.value.find((y) => new RegExp(`\\b${y.skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(label));
      return hit ? val(hit.years) : missing("This skill isn’t in your years-of-experience list");
    },
  },
  {
    key: "years_experience",
    category: "standard",
    patterns: [/\byears\b.*\bexperience\b/, /\bexperience\b.*\byears\b/],
    answer: (p, _f, ctx) => {
      if (!p.experience.some((e) => e.confirmedByUser && e.startDate)) return missing("No confirmed jobs with dates");
      return val(totalExperienceYears(p, ctx.today));
    },
  },
  {
    key: "current_company",
    category: "standard",
    patterns: [/\b(current|most recent|present) (company|employer|organization)\b/, /^company$/, /^employer$/, /^org$/],
    not: [/\bnotice\b/],
    answer: (p) => {
      const j = currentJob(p);
      return j ? val(j.company) : missing("No confirmed jobs");
    },
  },
  {
    key: "current_title",
    category: "standard",
    patterns: [/\b(current|most recent|present) (job )?(title|role|position)\b/],
    answer: (p) => {
      const j = currentJob(p);
      return j ? val(j.title) : missing("No confirmed jobs");
    },
  },

  // ---- education
  {
    key: "highest_education",
    category: "standard",
    patterns: [/\bhighest (level of )?(education|degree)\b/],
    answer: (p) => {
      const levels = p.education.filter((e) => e.confirmedByUser && e.degreeLevel).map((e) => e.degreeLevel!);
      if (!levels.length) return missing("No confirmed degrees with a level");
      const best = [...levels].sort((a, b) => DEGREE_RANK.indexOf(b) - DEGREE_RANK.indexOf(a))[0]!;
      return val(DEGREE_LABEL[best] ?? best, "degree_level");
    },
  },
  {
    key: "graduation_year",
    category: "standard",
    patterns: [/\bgraduation year\b/, /\bclass year\b/, /\byear of graduation\b/],
    answer: (p) => {
      const e = latestEducation(p);
      return e?.graduationDate ? val(e.graduationDate.slice(0, 4)) : missing("No confirmed graduation date");
    },
  },
  {
    key: "graduation_date",
    category: "standard",
    patterns: [/\bgraduat(e|ion)\b/],
    answer: (p, field) => {
      const e = latestEducation(p);
      return e?.graduationDate ? val(formatMonth(e.graduationDate, field)) : missing("No confirmed graduation date");
    },
  },
  {
    key: "gpa",
    category: "standard",
    patterns: [/\bgpa\b/, /\bgrade point average\b/],
    answer: (p) => {
      const e = latestEducation(p);
      return e?.gpa != null ? val(e.gpa.toFixed(e.gpa * 100 % 10 === 0 ? 1 : 2)) : missing("No confirmed GPA");
    },
  },
  {
    key: "major",
    category: "standard",
    patterns: [/^discipline$/, /\bmajor\b/, /\b(field|area) of study\b/, /\bconcentration\b/],
    answer: (p) => {
      const e = latestEducation(p);
      return e?.major ? val(e.major) : missing("No confirmed major");
    },
  },
  {
    key: "degree",
    category: "standard",
    patterns: [/^degree\b/, /\bdegree (type|name|earned)\b/],
    not: [/\benrolled\b/, /\bprogram\b/],
    answer: (p) => {
      const e = latestEducation(p);
      if (!e) return missing("No confirmed education");
      if (e.degreeLevel) return val(DEGREE_LABEL[e.degreeLevel] ?? e.degree, "degree_level");
      return e.degree ? val(e.degree) : missing("No confirmed degree");
    },
  },
  {
    key: "school",
    category: "standard",
    patterns: [/^(school|university|college)( name)?$/, /^college[ /]university$/, /\bwhat (school|university|college)\b/, /\bschool (name|attended)\b/, /^(school|university|college)( or (school|university|college))* attended$/],
    answer: (p) => {
      const e = latestEducation(p);
      return e ? val(e.school) : missing("No confirmed education");
    },
  },

  // ---- preferences
  {
    key: "desired_salary",
    category: "standard",
    patterns: [/\bsalary\b/, /\bcompensation\b/, /\bdesired pay\b/, /\bpay expectations?\b/],
    answer: (p, field) => {
      const s = confirmed(p.preferences.desiredSalary, "Desired salary");
      if (!isOk(s)) return s;
      if (field.type === "number") return val(s.ok);
      const cur = p.preferences.salaryCurrency.value ?? "USD";
      return val(cur === "USD" ? `$${s.ok.toLocaleString("en-US")}` : `${s.ok.toLocaleString("en-US")} ${cur}`);
    },
  },
  {
    key: "start_date",
    category: "standard",
    patterns: [/\bstart date\b/, /\bwhen can you start\b/, /\bdate available\b/, /\bavailable to start\b/, /\bavailability date\b/],
    answer: (p, field) => {
      const s = confirmed(p.preferences.earliestStartDate, "Earliest start date");
      if (!isOk(s)) return s;
      if (field.type === "date") return val(s.ok);
      const [y, m, d] = s.ok.split("-").map(Number);
      return val(new Date(y!, m! - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
    },
  },
  {
    key: "notice_period",
    category: "standard",
    patterns: [/\bnotice\b/],
    answer: (p) => {
      const n = confirmed(p.preferences.noticePeriodWeeks, "Notice period");
      if (!isOk(n)) return n;
      return val(n.ok === 0 ? "Available immediately" : `${n.ok} ${n.ok === 1 ? "week" : "weeks"}`);
    },
  },
  {
    key: "willing_to_relocate",
    category: "standard",
    patterns: [/\breloca(te|tion|ting)\b/],
    answer: (p) => fromField(p.preferences.willingToRelocate, "Willingness to relocate"),
  },
  {
    key: "how_did_you_hear",
    category: "standard",
    patterns: [/\bhow did you (hear|find|learn)\b/, /\bwhere did you (hear|find|learn)\b/, /^source$/, /\bhear about (us|this)\b/],
    answer: (p) => fromField(p.screening.howDidYouHear, "How did you hear about us"),
  },

  // ---- links
  { key: "linkedin", category: "standard", patterns: [/\blinked ?in\b/], answer: (p) => fromField(p.links.linkedin, "LinkedIn") },
  { key: "github", category: "standard", patterns: [/\bgit ?hub\b/], answer: (p) => fromField(p.links.github, "GitHub") },
  { key: "portfolio", category: "standard", patterns: [/\bportfolio\b/], answer: (p) => fromField(p.links.portfolio, "Portfolio") },
  {
    key: "website",
    category: "standard",
    patterns: [/\bwebsite\b/, /^blog$/, /^(personal )?(site|url)$/],
    answer: (p) => {
      const w = confirmed(p.links.website, "Website");
      if (isOk(w)) return val(w.ok);
      return fromField(p.links.portfolio, "Website");
    },
  },

  // ---- contact & identity
  {
    key: "phone_country_code",
    category: "standard",
    patterns: [/\b(country )?(phone|dialing|calling) (country )?code\b/, /^country code$/],
    answer: (p) => fromField(p.identity.phoneCountryCode, "Phone country code"),
  },
  {
    key: "phone",
    category: "standard",
    patterns: [/^(mobile |cell |home |work )?phone( number)?$/, /\b(phone|mobile|cell)( phone)? number\b/, /^contact number$/, /^telephone$/],
    not: [/\bdevice type\b/],
    answer: (p, field) => {
      const n = confirmed(p.identity.phoneNumber, "Phone number");
      if (!isOk(n)) return n;
      const cc = p.identity.phoneCountryCode;
      return val(cc.confirmedByUser && cc.value && field.type !== "tel" ? `${cc.value} ${n.ok}` : n.ok);
    },
  },
  { key: "email", category: "standard", patterns: [/\be ?mail\b/], answer: (p) => fromField(p.identity.email, "Email") },
  {
    key: "address_line2",
    category: "standard",
    patterns: [/\baddress line 2\b/, /\b(apartment|apt|suite|unit)\b/],
    answer: (p) => fromField(p.identity.addressLine2, "Address line 2"),
  },
  {
    key: "address_line1",
    category: "standard",
    patterns: [/^(street )?address( line 1)?$/, /\bstreet address\b/, /\baddress line 1\b/],
    answer: (p) => fromField(p.identity.addressLine1, "Street address"),
  },
  {
    key: "postal_code",
    category: "standard",
    patterns: [/\b(zip|postal|post) ?(code)?\b/],
    answer: (p) => fromField(p.identity.postalCode, "ZIP / postal code"),
  },
  {
    key: "current_location",
    category: "standard",
    patterns: [/^(current )?location\b/, /\bwhere are you (currently )?(located|based)\b/, /\bcurrently (located|based)\b/],
    answer: (p) => {
      const city = confirmed(p.identity.city, "City");
      if (!isOk(city)) return city;
      const region = p.identity.state.confirmedByUser && p.identity.state.value ? p.identity.state.value : p.identity.country.value;
      return val([city.ok, region].filter(Boolean).join(", "));
    },
  },
  { key: "city", category: "standard", patterns: [/^(town[ /])?city$/, /^city[ /]town$/], answer: (p) => fromField(p.identity.city, "City") },
  {
    key: "state",
    category: "standard",
    patterns: [/^state\b/, /^province$/, /^region$/, /^state province$/],
    answer: (p, field) => {
      const st = confirmed(p.identity.state, "State / province");
      if (!isOk(st)) return st;
      // Dropdowns usually list full names; profiles often hold the abbreviation (and vice versa).
      if (field.options?.length) {
        const full = US_STATES[st.ok.trim().toUpperCase()];
        const abbr = Object.entries(US_STATES).find(([, name]) => name.toLowerCase() === st.ok.trim().toLowerCase())?.[0];
        const labels = field.options.map((o) => o.label.toLowerCase());
        if (full && labels.includes(full.toLowerCase())) return val(full);
        if (abbr && labels.includes(abbr.toLowerCase())) return val(abbr);
      }
      return val(st.ok);
    },
  },
  {
    key: "country",
    category: "standard",
    patterns: [/^country\b/, /\bcountry of residence\b/],
    not: [/\bcitizen/],
    answer: (p) => fromField(p.identity.country, "Country"),
  },
  {
    key: "preferred_name",
    category: "standard",
    patterns: [/\bpreferred (first )?name\b/, /\bnickname\b/, /\bname do you go by\b/, /\bgo by\b/],
    answer: (p) => {
      const pref = confirmed(p.identity.preferredName, "Preferred name");
      if (isOk(pref)) return val(pref.ok);
      return fromField(p.identity.legalFirstName, "First name");
    },
  },
  {
    key: "middle_name",
    category: "standard",
    patterns: [/\bmiddle (name|initial)\b/],
    answer: (p, _f, _c, label) => {
      const m = p.identity.legalMiddleName;
      if (!m.confirmedByUser || !m.value) return val("");
      return val(/initial/.test(label) ? m.value.slice(0, 1) : m.value);
    },
  },
  {
    key: "first_name",
    category: "standard",
    patterns: [/\bfirst name\b/, /\bgiven name\b/, /\bforename\b/],
    answer: (p) => fromField(p.identity.legalFirstName, "First name"),
  },
  {
    key: "last_name",
    category: "standard",
    patterns: [/\blast name\b/, /\bsurname\b/, /\bfamily name\b/],
    answer: (p) => fromField(p.identity.legalLastName, "Last name"),
  },
  {
    key: "full_name",
    category: "standard",
    patterns: [/^(full |legal |full legal |your )?name$/, /\bfull (legal )?name\b/],
    answer: (p) => {
      const first = confirmed(p.identity.legalFirstName, "First name");
      const last = confirmed(p.identity.legalLastName, "Last name");
      if (!isOk(first)) return first;
      if (!isOk(last)) return last;
      return val(`${first.ok} ${last.ok}`);
    },
  },
];

export const CATALOG_BY_KEY = new Map(CATALOG.map((e) => [e.key, e]));

export const SENSITIVE_CATEGORIES: readonly Category[] = ["legal", "demographic"];

export function isSensitiveKey(key: string | null | undefined): boolean {
  if (!key) return false;
  const e = CATALOG_BY_KEY.get(key);
  return Boolean(e && SENSITIVE_CATEGORIES.includes(e.category));
}

/**
 * Safety net: words that mark a question as legal or demographic even when no
 * catalog entry matched. Such questions are never drafted by the LLM.
 */
export const SENSITIVE_WORDS = new RegExp(
  "\\b(" +
    [
      "authori[sz]\\w*", "sponsor\\w*", "visas?", "immigra\\w*", "citizen\\w*", "clearances?", "felon\\w*", "convict\\w*",
      "criminal\\w*", "crimes?", "arrest\\w*", "veterans?", "military", "disabilit\\w*", "disabled", "races?", "racial\\w*",
      "ethnic\\w*", "hispanic", "latin[oax]?", "latinx", "genders?", "sex", "sexual\\w*", "orientations?", "transgender",
      "trans", "lgbt\\w*", "pronouns?", "age", "ages", "birth\\w*", "18", "religio\\w*", "faith", "marital", "married",
      "pregnan\\w*", "national origin", "ssn", "social security", "certif(y|ies|ied)", "attest\\w*", "acknowledg\\w*",
      "consent\\w*", "agree\\w*", "signatures?", "sign", "signed", "background checks?", "drugs?", "accommodat\\w*",
      "salary history", "current salary", "medical", "health", "union", "genetic",
    ].join("|") +
    ")\\b",
);

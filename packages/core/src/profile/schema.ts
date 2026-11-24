import { z } from "zod";

/**
 * The profile is the single source of truth for everything Autoply says in the
 * user's name. Every scalar field is wrapped in `field()`, which records both
 * the value and whether the user explicitly confirmed it. List entries
 * (jobs, schools, ...) carry one `confirmedByUser` flag per entry.
 *
 * Legal and demographic answers may only ever be filled from fields whose
 * `confirmedByUser` is true. See `resolver/` and CLAUDE.md.
 */

function wrap<T extends z.ZodType>(inner: T) {
  return z.object({
    value: inner.nullable(),
    confirmedByUser: z.boolean(),
  });
}

export function field<T extends z.ZodType>(inner: T) {
  const s = wrap(inner);
  return s.prefault({ value: null, confirmedByUser: false } as z.input<typeof s>);
}

/** A field whose unconfirmed default is a concrete value (e.g. "decline"). */
export function fieldWithDefault<T extends z.ZodType>(inner: T, value: z.input<T>) {
  const s = wrap(inner);
  return s.prefault({ value, confirmedByUser: false } as z.input<typeof s>);
}

export type Field<T> = { value: T | null; confirmedByUser: boolean };

const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const url = z.url();
const entryId = z.string().min(1);

// ---------------------------------------------------------------- identity

export const IdentitySchema = z
  .object({
    legalFirstName: field(z.string().min(1)),
    legalMiddleName: field(z.string()),
    legalLastName: field(z.string().min(1)),
    preferredName: field(z.string()),
    pronouns: field(z.string()),
    email: field(z.email()),
    phoneCountryCode: field(z.string().regex(/^\+\d{1,4}$/, "Use +<digits>, e.g. +1")),
    phoneNumber: field(z.string().min(4)),
    addressLine1: field(z.string()),
    addressLine2: field(z.string()),
    city: field(z.string()),
    state: field(z.string()),
    postalCode: field(z.string()),
    country: field(z.string()),
  })
  .prefault({});

// ---------------------------------------------------------------- links

export const LinksSchema = z
  .object({
    linkedin: field(url),
    github: field(url),
    portfolio: field(url),
    website: field(url),
    other: field(z.array(z.object({ label: z.string().min(1), url }))),
  })
  .prefault({});

// ---------------------------------------------------------------- experience & education

export const ExperienceSchema = z.object({
  id: entryId,
  company: z.string().min(1),
  title: z.string().min(1),
  location: z.string().default(""),
  startDate: isoMonth.nullable().default(null),
  endDate: isoMonth.nullable().default(null),
  current: z.boolean().default(false),
  bullets: z.array(z.string()).default([]),
  confirmedByUser: z.boolean().default(false),
});

export const DegreeLevel = z.enum([
  "high_school",
  "associate",
  "bachelor",
  "master",
  "mba",
  "phd",
  "jd",
  "md",
  "certificate",
  "bootcamp",
  "other",
]);

export const EducationSchema = z.object({
  id: entryId,
  school: z.string().min(1),
  degreeLevel: DegreeLevel.nullable().default(null),
  degree: z.string().default(""),
  major: z.string().default(""),
  minor: z.string().default(""),
  gpa: z.number().min(0).max(10).nullable().default(null),
  gpaScale: z.number().positive().default(4),
  startDate: isoMonth.nullable().default(null),
  graduationDate: isoMonth.nullable().default(null),
  graduationExpected: z.boolean().default(false),
  honors: z.array(z.string()).default([]),
  confirmedByUser: z.boolean().default(false),
});

export const CertificationSchema = z.object({
  id: entryId,
  name: z.string().min(1),
  issuer: z.string().default(""),
  date: isoMonth.nullable().default(null),
  confirmedByUser: z.boolean().default(false),
});

export const LanguageProficiency = z.enum(["elementary", "limited_working", "professional_working", "full_professional", "native"]);

export const LanguageSchema = z.object({
  id: entryId,
  language: z.string().min(1),
  proficiency: LanguageProficiency,
  confirmedByUser: z.boolean().default(false),
});

export const PublicationSchema = z.object({
  id: entryId,
  title: z.string().min(1),
  venue: z.string().default(""),
  date: isoMonth.nullable().default(null),
  url: url.nullable().default(null),
  confirmedByUser: z.boolean().default(false),
});

export const ProjectSchema = z.object({
  id: entryId,
  name: z.string().min(1),
  description: z.string().default(""),
  url: url.nullable().default(null),
  skills: z.array(z.string()).default([]),
  confirmedByUser: z.boolean().default(false),
});

// ---------------------------------------------------------------- work authorization

export const ClearanceLevel = z.enum(["none", "public_trust", "confidential", "secret", "top_secret", "ts_sci"]);

export const WorkAuthorizationSchema = z
  .object({
    /** One entry per target country, e.g. { country: "US", authorized: true }. */
    authorizedCountries: field(z.array(z.object({ country: z.string().min(2), authorized: z.boolean() }))),
    requiresSponsorshipNow: field(z.boolean()),
    requiresSponsorshipFuture: field(z.boolean()),
    visaType: field(z.string()),
    citizenship: field(z.array(z.string().min(2))),
    securityClearance: field(ClearanceLevel),
  })
  .prefault({});

// ---------------------------------------------------------------- preferences

export const Seniority = z.enum(["intern", "entry", "mid", "senior", "staff", "principal", "manager", "director"]);
export const WorkplaceType = z.enum(["remote", "hybrid", "onsite"]);
export const EmploymentType = z.enum(["full_time", "part_time", "contract", "internship", "temporary"]);

export const PreferencesSchema = z
  .object({
    targetTitles: field(z.array(z.string().min(1))),
    seniority: field(z.array(Seniority)),
    locations: field(z.array(z.string().min(1))),
    workplaceTypes: field(z.array(WorkplaceType)),
    willingToRelocate: field(z.boolean()),
    minimumSalary: field(z.number().int().nonnegative()),
    desiredSalary: field(z.number().int().nonnegative()),
    salaryCurrency: fieldWithDefault(z.string().length(3), "USD"),
    earliestStartDate: field(isoDate),
    noticePeriodWeeks: field(z.number().int().min(0).max(52)),
    employmentTypes: field(z.array(EmploymentType)),
    excludedCompanies: fieldWithDefault(z.array(z.string()), []),
    excludedKeywords: fieldWithDefault(z.array(z.string()), []),
  })
  .prefault({});

// ---------------------------------------------------------------- voluntary self-identification (EEO)

export const DECLINE = "decline" as const;

export const Gender = z.enum(["male", "female", "non_binary", DECLINE]);
export const RaceEthnicity = z.enum([
  "american_indian_alaska_native",
  "asian",
  "black_african_american",
  "native_hawaiian_pacific_islander",
  "white",
  "two_or_more",
  DECLINE,
]);
export const YesNoDecline = z.enum(["yes", "no", DECLINE]);
export const VeteranStatus = z.enum(["protected_veteran", "not_protected_veteran", DECLINE]);
export const SexualOrientation = z.enum([
  "heterosexual",
  "gay",
  "lesbian",
  "bisexual",
  "queer",
  "asexual",
  "pansexual",
  "other",
  DECLINE,
]);

/**
 * Every EEO field defaults to "decline", but unconfirmed. The onboarding
 * wizard shows the default and the user confirms it; until then the resolver
 * treats the field as missing and routes it to Needs Input.
 */
export const EeoSchema = z
  .object({
    gender: fieldWithDefault(Gender, DECLINE),
    raceEthnicity: fieldWithDefault(z.array(RaceEthnicity).min(1), [DECLINE]),
    hispanicLatino: fieldWithDefault(YesNoDecline, DECLINE),
    veteranStatus: fieldWithDefault(VeteranStatus, DECLINE),
    disabilityStatus: fieldWithDefault(YesNoDecline, DECLINE),
    sexualOrientation: fieldWithDefault(SexualOrientation, DECLINE),
    transgender: fieldWithDefault(YesNoDecline, DECLINE),
  })
  .prefault({});

// ---------------------------------------------------------------- screening answers

export const ScreeningSchema = z
  .object({
    over18: field(z.boolean()),
    hasCriminalConviction: field(z.boolean()),
    criminalConvictionExplanation: field(z.string()),
    /** Companies the user previously worked at (beyond their experience list), e.g. contracts. */
    previousEmployers: fieldWithDefault(z.array(z.string()), []),
    hasNonCompete: field(z.boolean()),
    nonCompeteDetails: field(z.string()),
    /** Companies where the user has a relative employed. */
    relativesAtCompanies: fieldWithDefault(z.array(z.string()), []),
    howDidYouHear: field(z.string()),
    willingBackgroundCheck: field(z.boolean()),
    willingDrugTest: field(z.boolean()),
    skillYears: fieldWithDefault(z.array(z.object({ skill: z.string().min(1), years: z.number().min(0).max(60) })), []),
  })
  .prefault({});

// ---------------------------------------------------------------- voice

export const VoiceSchema = z
  .object({
    tone: field(z.string().max(600)),
    /** Pasted past cover letters, used only as style references. */
    examples: fieldWithDefault(z.array(z.string()), []),
  })
  .prefault({});

// ---------------------------------------------------------------- onboarding progress

export const ONBOARDING_STEPS = [
  "resume",
  "identity",
  "experience",
  "education",
  "skills",
  "authorization",
  "preferences",
  "eeo",
  "screening",
  "voice",
  "review",
] as const;
export const OnboardingStep = z.enum(ONBOARDING_STEPS);

export const OnboardingSchema = z
  .object({
    currentStep: OnboardingStep.default("resume"),
    completedSteps: z.array(OnboardingStep).default([]),
    completedAt: z.iso.datetime().nullable().default(null),
  })
  .prefault({});

// ---------------------------------------------------------------- profile

export const ProfileSchema = z.object({
  version: z.literal(1).default(1),
  identity: IdentitySchema,
  links: LinksSchema,
  experience: z.array(ExperienceSchema).default([]),
  education: z.array(EducationSchema).default([]),
  skills: fieldWithDefault(z.array(z.string().min(1)), []),
  certifications: z.array(CertificationSchema).default([]),
  languages: z.array(LanguageSchema).default([]),
  publications: z.array(PublicationSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  workAuthorization: WorkAuthorizationSchema,
  preferences: PreferencesSchema,
  eeo: EeoSchema,
  screening: ScreeningSchema,
  voice: VoiceSchema,
  onboarding: OnboardingSchema,
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileInput = z.input<typeof ProfileSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Education = z.infer<typeof EducationSchema>;

export function emptyProfile(): Profile {
  return ProfileSchema.parse({});
}

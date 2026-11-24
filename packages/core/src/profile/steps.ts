import { z } from "zod";
import { ONBOARDING_STEPS, ProfileSchema, type Profile } from "./schema.ts";

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

/** Scalar sections whose fields are { value, confirmedByUser }. */
export const SCALAR_SECTIONS = ["identity", "links", "workAuthorization", "preferences", "eeo", "screening", "voice"] as const;
type ScalarSection = (typeof SCALAR_SECTIONS)[number];
/** List sections whose entries each carry confirmedByUser. */
export const LIST_SECTIONS = ["experience", "education", "certifications", "languages", "projects", "publications"] as const;
type ListSection = (typeof LIST_SECTIONS)[number];

/** Which profile sections each onboarding step edits. */
export const STEP_SECTIONS: Record<OnboardingStepId, { scalar: ScalarSection[]; list: ListSection[]; skills?: true }> = {
  resume: { scalar: [], list: [] },
  identity: { scalar: ["identity", "links"], list: [] },
  experience: { scalar: [], list: ["experience"] },
  education: { scalar: [], list: ["education"] },
  skills: { scalar: [], list: ["certifications", "languages", "projects", "publications"], skills: true },
  authorization: { scalar: ["workAuthorization"], list: [] },
  preferences: { scalar: ["preferences"], list: [] },
  eeo: { scalar: ["eeo"], list: [] },
  screening: { scalar: ["screening"], list: [] },
  voice: { scalar: ["voice"], list: [] },
  review: { scalar: [], list: [] },
};

/**
 * A step submission: plain values (not wrapped), exactly as the user left them
 * on screen. Submitting is the user's confirmation of every value shown.
 */
export type StepPatch = {
  [S in ScalarSection]?: Record<string, unknown>;
} & {
  [L in ListSection]?: Record<string, unknown>[];
} & { skills?: string[] };

export class StepValidationError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "StepValidationError";
  }
}

function isAnswered(v: unknown) {
  return v !== null && v !== undefined && v !== "";
}

/** Answers the wizard insists on before moving on: legal statements Autoply will need constantly. */
const REQUIRED: Partial<Record<OnboardingStepId, { path: string; label: string }[]>> = {
  identity: [
    { path: "identity.legalFirstName", label: "Legal first name" },
    { path: "identity.legalLastName", label: "Legal last name" },
    { path: "identity.email", label: "Email" },
    { path: "identity.phoneNumber", label: "Phone number" },
  ],
  authorization: [
    { path: "workAuthorization.authorizedCountries", label: "Work authorization" },
    { path: "workAuthorization.requiresSponsorshipNow", label: "Sponsorship now" },
    { path: "workAuthorization.requiresSponsorshipFuture", label: "Sponsorship in the future" },
  ],
  eeo: [
    { path: "eeo.gender", label: "Gender" },
    { path: "eeo.raceEthnicity", label: "Race / ethnicity" },
    { path: "eeo.hispanicLatino", label: "Hispanic or Latino" },
    { path: "eeo.veteranStatus", label: "Veteran status" },
    { path: "eeo.disabilityStatus", label: "Disability status" },
    { path: "eeo.sexualOrientation", label: "Sexual orientation" },
    { path: "eeo.transgender", label: "Transgender" },
  ],
  screening: [{ path: "screening.over18", label: "Over 18" }],
};

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/**
 * Applies a step submission: wraps each value with confirmedByUser (true when
 * the value is non-empty), marks submitted list entries confirmed, validates
 * the whole profile, and records onboarding progress.
 */
export function applyStep(profile: Profile, step: OnboardingStepId, patch: StepPatch, opts: { advance?: boolean } = {}): Profile {
  const next = structuredClone(profile) as Record<string, unknown> & Profile;
  const sections = STEP_SECTIONS[step];
  const issues: { path: string; message: string }[] = [];

  for (const section of sections.scalar) {
    const values = patch[section];
    if (!values) continue;
    const current = next[section] as Record<string, { value: unknown; confirmedByUser: boolean }>;
    for (const [k, v] of Object.entries(values)) {
      if (!(k in current)) {
        issues.push({ path: `${section}.${k}`, message: "Unknown field" });
        continue;
      }
      const value = typeof v === "string" ? v.trim() : v;
      current[k] = { value: isAnswered(value) ? value : null, confirmedByUser: isAnswered(value) };
    }
  }
  for (const section of sections.list) {
    const entries = patch[section];
    if (!entries) continue;
    (next as Record<string, unknown>)[section] = entries.map((e) => ({ ...e, confirmedByUser: true }));
  }
  if (sections.skills && patch.skills) {
    const skills = [...new Set(patch.skills.map((s) => s.trim()).filter(Boolean))];
    next.skills = { value: skills, confirmedByUser: true };
  }

  for (const req of REQUIRED[step] ?? []) {
    const f = get(next, req.path) as { value: unknown; confirmedByUser: boolean } | undefined;
    const empty = !f || !f.confirmedByUser || f.value === null || (Array.isArray(f.value) && f.value.length === 0);
    if (empty) issues.push({ path: req.path, message: `${req.label} is required` });
  }

  if (opts.advance !== false) {
    const done = new Set(next.onboarding.completedSteps);
    done.add(step);
    next.onboarding.completedSteps = ONBOARDING_STEPS.filter((s) => done.has(s));
    const idx = ONBOARDING_STEPS.indexOf(step);
    const following = ONBOARDING_STEPS[idx + 1];
    if (following) next.onboarding.currentStep = following;
  }

  const parsed = ProfileSchema.safeParse(next);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ path: i.path.filter((p) => p !== "value").join("."), message: i.message });
  }
  if (issues.length) throw new StepValidationError(issues);
  return parsed.data!;
}

export function completeOnboarding(profile: Profile, now = new Date()): Profile {
  const missing = ONBOARDING_STEPS.filter((s) => s !== "review" && !profile.onboarding.completedSteps.includes(s));
  if (missing.length) throw new StepValidationError(missing.map((s) => ({ path: s, message: "Step not finished" })));
  const next = structuredClone(profile);
  next.onboarding.completedSteps = [...ONBOARDING_STEPS];
  next.onboarding.currentStep = "review";
  next.onboarding.completedAt = now.toISOString();
  return next;
}

/** Plain-value view of a scalar section, for forms. */
export function sectionValues<S extends ScalarSection>(profile: Profile, section: S) {
  return Object.fromEntries(Object.entries(profile[section]).map(([k, f]) => [k, (f as { value: unknown }).value])) as {
    [K in keyof Profile[S]]: Profile[S][K] extends { value: infer V } ? V : never;
  };
}

export const StepIdSchema = z.enum(ONBOARDING_STEPS);

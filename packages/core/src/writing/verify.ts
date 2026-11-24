import { z } from "zod";
import type { Llm } from "../llm/types.ts";
import type { KnownFacts } from "./facts.ts";
import { NUMBER_WORD_PATTERN, allNumbers, matchesAny, norm, normNumber, normSkill, stem, tokenSubset, tokens, wordToNumber } from "./normalize.ts";

export const CLAIM_TYPES = ["employer", "title", "school", "degree", "skill", "metric", "project", "certification", "duration", "other_fact"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const ClaimsSchema = z.object({
  claims: z.array(
    z.object({
      text: z.string().describe("The sentence or phrase making the assertion, quoted from the text"),
      type: z.enum(CLAIM_TYPES),
      value: z
        .string()
        .describe("The asserted entity or figure alone: the employer name, the skill, the number with its unit, '2 years', etc."),
    }),
  ),
});
export type Claim = z.infer<typeof ClaimsSchema>["claims"][number];
export type UnsupportedClaim = { claim: Claim; reason: string };
export type CheckResult = { supported: Claim[]; unsupported: UnsupportedClaim[] };

const EXTRACT_SYSTEM = `You audit text written on behalf of a job applicant. List every checkable factual assertion the text makes about the APPLICANT.

Include: employers they worked or interned at, job titles they held, schools attended, degrees and majors, skills and technologies they claim to have used, projects they built, certifications, numbers and metrics (percentages, counts, sizes, times, GPAs), durations ("two years of experience"), and any other concrete claim about what they did.

Exclude: opinions, enthusiasm, goals, and general statements ("I am excited about..."); anything about the hiring company or the job; greetings and sign-offs.

Split compound sentences into one claim per assertion. Quote the text exactly in "text" and give just the asserted entity or figure in "value". Do not judge whether a claim is true.`;

/** Asks the model to list every checkable assertion about the applicant in `text`. */
export async function extractClaims(llm: Llm, text: string): Promise<Claim[]> {
  const out = await llm.structured({
    task: "extract_claims",
    system: EXTRACT_SYSTEM,
    content: `Text to audit:\n\n<text>\n${text}\n</text>`,
    schema: ClaimsSchema,
    replayKey: { text },
  });
  return out.claims;
}

// ------------------------------------------------------------------ durations

const DURATION_RE = new RegExp(`\\b(\\d+(?:\\.\\d+)?|${NUMBER_WORD_PATTERN})\\s*\\+?[\\s-]*(years?|months?|weeks?)\\b`, "gi");
const EDU_CONTEXT = /\b(study|studied|studying|student|university|college|school|degree|undergraduate|graduate|coursework|major|classes|class)\b/i;

type Duration = { months: number; unit: "year" | "month" | "week"; index: number; length: number };

function durationsIn(text: string): Duration[] {
  const out: Duration[] = [];
  for (const m of text.matchAll(DURATION_RE)) {
    const raw = m[1]!;
    const n = /^\d/.test(raw) ? Number.parseFloat(raw) : (wordToNumber(raw) ?? 0);
    const unit = m[2]!.toLowerCase().replace(/s$/, "") as Duration["unit"];
    const months = unit === "year" ? n * 12 : unit === "month" ? n : n / 4.345;
    out.push({ months, unit, index: m.index, length: m[0].length });
  }
  return out;
}

function durationProblem(d: Duration, context: string, known: KnownFacts): string | null {
  const edu = EDU_CONTEXT.test(context);
  const limit = edu ? known.educationMonths : known.experienceMonths;
  const slack = d.unit === "year" ? 3 : 1;
  if (d.months <= limit + slack) return null;
  const what = edu ? "education" : "experience";
  return `Claims ${Math.round(d.months)} months but the profile's ${what} dates support about ${limit}`;
}

// ------------------------------------------------------------------ claim checks

const STOP = new Set([
  "that", "with", "have", "this", "from", "their", "them", "been", "were", "which", "would", "could", "also", "into", "over", "more",
  "applicant", "while", "where", "when", "than", "then", "they", "some", "such", "very", "your", "about", "other", "many", "much",
  "each", "just", "both", "only", "will", "what", "like", "using", "used", "work", "worked", "role", "team",
]);

function unknownNumbers(value: string, known: KnownFacts, includeOne = false): string[] {
  return allNumbers(value, { includeOne }).filter((n) => !known.numbers.has(n));
}

function termsUnsupported(text: string, known: KnownFacts): string | null {
  const terms = tokens(text)
    .filter((t) => t.length >= 4 && !/\d/.test(t) && !STOP.has(t))
    .map(stem);
  if (terms.length === 0) return "No checkable terms; cannot be confirmed from the profile";
  const missing = terms.filter((t) => !known.factTokens.has(t));
  return missing.length ? `Not found in the profile: ${[...new Set(missing)].join(", ")}` : null;
}

function splitList(v: string): string[] {
  return v.split(/,|;|\band\b|&|\//i).map((s) => s.trim()).filter(Boolean);
}

function checkOne(claim: Claim, known: KnownFacts): string | null {
  const value = claim.value.trim() || claim.text.trim();
  switch (claim.type) {
    case "employer":
      return matchesAny(value, known.employers) ? null : `Employer "${value}" is not in the profile`;
    case "school":
      return matchesAny(value, known.schools) ? null : `School "${value}" is not in the profile`;
    case "project":
      return matchesAny(value, known.projects) ? null : `Project "${value}" is not in the profile`;
    case "certification":
      return matchesAny(value, known.certifications) ? null : `Certification "${value}" is not in the profile`;
    case "title": {
      for (const t of known.titles) if (tokenSubset(value, t)) return null;
      return `Title "${value}" is not in the profile`;
    }
    case "degree": {
      const degTokens = (s: string) => tokens(s).map(stem).map((t) => (["bs", "bsc", "ba", "bachelors"].includes(t) ? "bachelor" : ["ms", "msc", "ma", "masters"].includes(t) ? "master" : t));
      const want = degTokens(value).filter((t) => !["of", "in", "degree", "and", "the", "a"].includes(t));
      if (want.length === 0) return `Degree "${value}" cannot be checked`;
      for (const d of known.degrees) {
        const have = new Set(degTokens(d));
        if (want.every((t) => have.has(t))) return null;
      }
      return `Degree "${value}" is not in the profile`;
    }
    case "skill": {
      const items = splitList(value);
      const bad = items.filter((s) => !known.skills.has(normSkill(s)));
      if (items.length === 0) return "Empty skill claim";
      return bad.length ? `Skill not in the profile: ${bad.join(", ")}` : null;
    }
    case "metric": {
      const nums = allNumbers(`${claim.value} ${claim.value ? "" : claim.text}`, { includeOne: true });
      if (nums.length === 0) return termsUnsupported(claim.text, known);
      const bad = nums.filter((n) => !known.numbers.has(n));
      return bad.length ? `Number${bad.length > 1 ? "s" : ""} not in the profile: ${bad.join(", ")}` : null;
    }
    case "duration": {
      const ds = durationsIn(`${claim.value} ${claim.text}`);
      if (ds.length === 0) return "Duration cannot be verified from the profile dates";
      for (const d of ds) {
        const p = durationProblem(d, claim.text, known);
        if (p) return p;
      }
      return null;
    }
    case "other_fact": {
      const bad = unknownNumbers(claim.text, known, true);
      if (bad.length) return `Number${bad.length > 1 ? "s" : ""} not in the profile: ${bad.join(", ")}`;
      return termsUnsupported(claim.text, known);
    }
  }
}

/** Deterministic and strict: when unsure, a claim is unsupported. */
export function checkClaims(claims: Claim[], known: KnownFacts): CheckResult {
  const supported: Claim[] = [];
  const unsupported: UnsupportedClaim[] = [];
  for (const claim of claims) {
    const reason = checkOne(claim, known);
    if (reason) unsupported.push({ claim, reason });
    else supported.push(claim);
  }
  return { supported, unsupported };
}

// ------------------------------------------------------------------ deterministic scan

const ORG_WORDS = new Set([
  "inc", "llc", "ltd", "corp", "corporation", "labs", "lab", "technologies", "technology", "systems", "university", "college",
  "institute", "group", "company", "software", "solutions", "partners", "studios", "foundation", "bank", "consulting", "ventures",
  "research", "capital", "networks", "industries",
]);
const NOT_ENTITY_START = "I|I'm|I've|I'd|I’m|I’ve|My|We|The|This|It|In|As|At|On|And|But|Or|To|For|With|From";
const CAP = `(?!(?:${NOT_ENTITY_START})\\b)[A-Z][A-Za-z0-9&'’-]*(?:\\.[A-Za-z0-9]+)*`;
const ENTITY = `${CAP}(?:\\s+(?:(?:of|and|&|at|the)\\s+)?${CAP})*`;
const AT_ENTITY_RE = new RegExp(`\\b(?:[Aa]t|[Jj]oined|[Ee]mployed (?:by|at)|[Ww]orked (?:at|for)|[Ii]nterned (?:at|with))\\s+(${ENTITY})`, "g");
const ORG_ENTITY_RE = new RegExp(`\\b${ENTITY}`, "g");

function entityKnown(entity: string, known: KnownFacts, allowed: string[]): boolean {
  if (known.applicantName && norm(known.applicantName) === norm(entity)) return true;
  if (allowed.some((a) => a && (matchesAny(entity, [a]) || norm(a).includes(norm(entity))))) return true;
  if (known.skills.has(normSkill(entity))) return true;
  return [known.employers, known.schools, known.projects, known.certifications].some((s) => matchesAny(entity, s));
}

export type ScanOptions = {
  /** Names the text may mention freely, e.g. the hiring company and job title. */
  allowedEntities?: string[];
};

/**
 * Pattern-based check that does not depend on the LLM extractor: numbers and
 * durations the profile can't support, and organization-looking names that
 * aren't the applicant's own or the hiring company.
 */
export function scanText(text: string, known: KnownFacts, opts: ScanOptions = {}): UnsupportedClaim[] {
  const out: UnsupportedClaim[] = [];
  const allowed = opts.allowedEntities ?? [];
  const sentenceAround = (index: number, length: number) => {
    const start = Math.max(text.lastIndexOf(".", index - 1) + 1, text.lastIndexOf("\n", index - 1) + 1, 0);
    const endDot = text.indexOf(".", index + length);
    const endNl = text.indexOf("\n", index + length);
    const end = Math.min(...[endDot, endNl].filter((i) => i >= 0), text.length);
    return text.slice(start, end + 1).trim();
  };

  // Durations first, then blank them out so their digits aren't double-counted as metrics.
  const durations = durationsIn(text);
  let rest = text;
  for (const d of [...durations].reverse()) {
    const ctx = text.slice(Math.max(0, d.index - 60), d.index + d.length + 60);
    const problem = durationProblem(d, ctx, known);
    const phrase = text.slice(d.index, d.index + d.length);
    if (problem) out.push({ claim: { text: sentenceAround(d.index, d.length), type: "duration", value: phrase }, reason: problem });
    rest = `${rest.slice(0, d.index)}${" ".repeat(d.length)}${rest.slice(d.index + d.length)}`;
  }
  out.reverse();

  const seenNumbers = new Set<string>();
  const numberRe = new RegExp(`\\d[\\d,]*(?:\\.\\d+)?|\\b(?:${NUMBER_WORD_PATTERN})\\b`, "gi");
  for (const m of rest.matchAll(numberRe)) {
    const raw = m[0];
    const n = /^\d/.test(raw) ? normNumber(raw) : String(wordToNumber(raw));
    if (raw.toLowerCase() === "one" || known.numbers.has(n) || seenNumbers.has(n)) continue;
    seenNumbers.add(n);
    out.push({
      claim: { text: sentenceAround(m.index, raw.length), type: "metric", value: raw },
      reason: `Number "${raw}" does not appear in the profile`,
    });
  }

  const seenEntities = new Set<string>();
  const flagEntity = (entity: string, index: number) => {
    const clean = entity.replace(/[.,;:]+$/, "");
    const key = norm(clean);
    if (!key || seenEntities.has(key) || entityKnown(clean, known, allowed)) return;
    seenEntities.add(key);
    out.push({
      claim: { text: sentenceAround(index, clean.length), type: "employer", value: clean },
      reason: `Organization "${clean}" is not in the profile or the job posting`,
    });
  };
  for (const m of text.matchAll(AT_ENTITY_RE)) flagEntity(m[1]!, m.index);
  for (const m of text.matchAll(ORG_ENTITY_RE)) {
    const words = m[0].split(/\s+/);
    if (words.length >= 2 && words.some((w) => ORG_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, "")))) flagEntity(m[0], m.index);
  }
  return out;
}

/** Extracted-claim check plus the deterministic scan, merged and de-duplicated. */
export async function verifyText(llm: Llm, text: string, known: KnownFacts, opts: ScanOptions = {}): Promise<CheckResult> {
  const claims = await extractClaims(llm, text);
  const checked = checkClaims(claims, known);
  const unsupported = [...checked.unsupported];
  const seen = new Set(unsupported.map((u) => norm(u.claim.value)));
  for (const s of scanText(text, known, opts)) {
    const key = norm(s.claim.value);
    if (seen.has(key)) continue;
    seen.add(key);
    unsupported.push(s);
  }
  return { supported: checked.supported, unsupported };
}

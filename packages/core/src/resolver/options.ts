import { normalizeQuestion } from "./normalize.ts";
import type { FormField } from "./types.ts";

export type Option = { value: string; label: string };
export type OptionMatch = { ok: true; options: Option[]; reason: string } | { ok: false; reason: string };

const n = (s: string) => normalizeQuestion(s);

/** "Decline to answer" in every wording seen on ATS forms. */
export const DECLINE_RE =
  /\b(decline|declined|don t wish|do not wish|dont wish|prefer not|choose not|rather not|not wish to|do not want|don t want|dont want|not to (answer|disclose|say|specify|self identify|identify|respond)|no answer|wish not to|opt out|undisclosed|not disclosed|not specified|unspecified|not declared)\b|^n a$/;

const YES_RE = /^(yes|y|true)\b/;
const NO_RE = /^(no|n|false)\b/;

type Matcher = (optionLabel: string, questionLabel: string) => boolean;

/** Per-enum matchers. Each value lists predicates that identify its option. */
const ENUM_MATCHERS: Record<string, Record<string, Matcher>> = {
  gender: {
    male: (o) => /^(male|man|men|cis ?gender man|cis man|m)$|^(male|man)\b/.test(o),
    female: (o) => /^(female|woman|women|cis ?gender woman|cis woman|f)$|^(female|woman)\b/.test(o),
    non_binary: (o) => /\bnon ?binary\b|\bgenderqueer\b|\bgender non ?conforming\b|\bgender ?fluid\b/.test(o),
    decline: (o) => DECLINE_RE.test(o),
  },
  race: {
    american_indian_alaska_native: (o) => /\b(american indian|alaska n native|alaskan native|alaska native|native american|indigenous|first nations)\b/.test(o),
    asian: (o) => /\basian\b/.test(o) && !/\bpacific islander\b/.test(o.replace(/\basian or\b/, "")),
    black_african_american: (o) => /\bblack\b|\bafrican american\b/.test(o),
    native_hawaiian_pacific_islander: (o) => /\bhawaiian\b|\bpacific islander\b/.test(o),
    white: (o) => /\bwhite\b|\bcaucasian\b/.test(o),
    two_or_more: (o) => /\btwo or more\b|\bmulti ?racial\b|\bmixed\b|\bmultiple races\b/.test(o),
    decline: (o) => DECLINE_RE.test(o),
  },
  yes_no_decline: {
    yes: (o) => YES_RE.test(o),
    no: (o) => NO_RE.test(o),
    decline: (o) => DECLINE_RE.test(o),
  },
  veteran: {
    protected_veteran: (o) =>
      !/\bnot\b/.test(o) && (/\bidentify as\b.*\bprotected veteran/.test(o) || /\bi am a (protected )?veteran\b/.test(o) || /^protected veteran\b/.test(o) || YES_RE.test(o)),
    not_protected_veteran: (o, q) =>
      /\bnot a protected veteran\b|\bi am not a\b.*\bveteran\b|\bnot a veteran\b|^not (a )?protected\b/.test(o) ||
      // A bare "No" only means "not a protected veteran" when the question is about protected status.
      (NO_RE.test(o) && /\bprotected\b/.test(q)),
    decline: (o) => DECLINE_RE.test(o),
  },
  sexual_orientation: {
    heterosexual: (o, q) => /\bheterosexual\b|\bstraight\b/.test(o) || (/\blgbt/.test(q) && NO_RE.test(o)),
    gay: (o, q) => /\bgay\b/.test(o) || (/\blgbt/.test(q) && YES_RE.test(o)),
    lesbian: (o, q) => /\blesbian\b/.test(o) || (/\blgbt/.test(q) && YES_RE.test(o)),
    bisexual: (o, q) => /\bbisexual\b/.test(o) || (/\blgbt/.test(q) && YES_RE.test(o)),
    queer: (o, q) => /\bqueer\b/.test(o) || (/\blgbt/.test(q) && YES_RE.test(o)),
    asexual: (o, q) => /\basexual\b/.test(o) || (/\blgbt/.test(q) && YES_RE.test(o)),
    pansexual: (o, q) => /\bpansexual\b/.test(o) || (/\blgbt/.test(q) && YES_RE.test(o)),
    other: (o) => /\b(other|self describe|not listed|prefer to self describe)\b/.test(o),
    decline: (o) => DECLINE_RE.test(o),
  },
};

function uniqueMatches(options: Option[], pred: (label: string) => boolean): Option[] {
  return options.filter((o) => pred(n(o.label)));
}

/** Maps an enum value (gender, veteran, ...) onto the field's options. */
export function matchEnum(enumKey: string, value: string | string[], field: FormField, questionLabel: string): OptionMatch {
  const options = field.options ?? [];
  const matchers = ENUM_MATCHERS[enumKey];
  if (!matchers) return { ok: false, reason: `No option rules for ${enumKey}` };
  const q = n(questionLabel);
  const values = Array.isArray(value) ? value : [value];

  // Several races on a single-choice question → "Two or more races" if offered.
  if (values.length > 1 && !field.multiple) {
    if (enumKey === "race" && matchers.two_or_more) {
      const two = uniqueMatches(options, (o) => matchers.two_or_more!(o, q));
      if (two.length === 1) return { ok: true, options: two, reason: "Several races selected; form allows one answer, chose “Two or more races”" };
    }
    return { ok: false, reason: "Your answer has several values but the form allows one" };
  }

  const chosen: Option[] = [];
  for (const v of values) {
    const m = matchers[v];
    if (!m) return { ok: false, reason: `Unknown value “${v}”` };
    const hits = uniqueMatches(options, (o) => m(o, q));
    if (hits.length === 0) return { ok: false, reason: `No option on this form matches “${v.replace(/_/g, " ")}”` };
    if (hits.length > 1) return { ok: false, reason: `More than one option could mean “${v.replace(/_/g, " ")}”` };
    // Guard against one option matching two different values (e.g. a combined option).
    for (const [other, om] of Object.entries(matchers)) {
      if (other !== v && !values.includes(other) && om(n(hits[0]!.label), q) && !(enumKey === "sexual_orientation" && /\blgbt/.test(q))) {
        return { ok: false, reason: `Option “${hits[0]!.label}” could mean more than one answer` };
      }
    }
    chosen.push(hits[0]!);
  }
  return { ok: true, options: chosen, reason: `Matched ${values.map((v) => v.replace(/_/g, " ")).join(", ")}` };
}

/** Maps a yes/no answer onto options whose labels start with Yes/No. */
export function matchBoolean(value: boolean, field: FormField): OptionMatch {
  const options = field.options ?? [];
  const hits = uniqueMatches(options, (o) => (value ? YES_RE : NO_RE).test(o));
  if (hits.length === 1) return { ok: true, options: hits, reason: `Answered ${value ? "Yes" : "No"}` };
  if (hits.length > 1) return { ok: false, reason: `More than one “${value ? "Yes" : "No"}” option` };
  // Two options that differ only by a negation: "Authorized to work" / "Not authorized to work".
  if (options.length === 2) {
    const NEG = /\b(not|no|don t|do not|cannot|can t|won t|will not|unable)\b/;
    const strip = (l: string) => n(l).replace(/\b(i am|i m|i)\b/g, "").replace(NEG, "").replace(/\s+/g, " ").trim();
    const [a, b] = options as [Option, Option];
    const aNeg = NEG.test(n(a.label));
    const bNeg = NEG.test(n(b.label));
    if (aNeg !== bNeg && strip(a.label) === strip(b.label)) {
      const pick = value ? (aNeg ? b : a) : aNeg ? a : b;
      return { ok: true, options: [pick], reason: `Answered “${pick.label}”` };
    }
  }
  return { ok: false, reason: "The options aren’t a plain yes/no" };
}

const rangeLabel = (l: string) =>
  l
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s*years?\b.*$/, "")
    .replace(/\s+/g, " ")
    .trim();

const RANGE_RE = /^(less than|under|<)?\s*(\d+(?:\.\d+)?)\s*(?:(?:-|to)\s*(\d+(?:\.\d+)?))?\s*(\+|or more|plus|and above)?/;

/** Maps a number onto range options like "0-1 years", "3+", "Less than 1 year". */
export function matchNumber(value: number, field: FormField): OptionMatch {
  const options = field.options ?? [];
  const fits = options.filter((o) => {
    // Ranges need the hyphen, which normalizeQuestion strips; use a lighter normalization here.
    const m = rangeLabel(o.label).match(RANGE_RE);
    if (!m) return false;
    const lo = Number(m[2]);
    const hi = m[3] !== undefined ? Number(m[3]) : undefined;
    if (m[1]) return value < lo;
    if (m[4]) return value >= lo;
    if (hi !== undefined) return value >= lo && value <= hi;
    return value === lo;
  });
  if (fits.length === 1) return { ok: true, options: fits, reason: `${value} fits “${fits[0]!.label}”` };
  // Overlapping ranges ("0-1", "1-3"): prefer the one where value is not the upper bound.
  if (fits.length > 1) {
    const strict = fits.filter((o) => {
      const m = rangeLabel(o.label).match(RANGE_RE);
      return !(m?.[3] !== undefined && Number(m[3]) === value);
    });
    if (strict.length === 1) return { ok: true, options: strict, reason: `${value} fits “${strict[0]!.label}”` };
  }
  return { ok: false, reason: `No single option fits ${value}` };
}

const tokens = (s: string) => new Set(n(s).split(" ").filter((t) => t.length > 1 && !["the", "of", "a", "an", "and", "or", "in", "s"].includes(t)));

/**
 * Maps free text onto options: exact, then containment, then the best token
 * overlap. `allowOther` lets "Other" catch an unmatched value (only used
 * where that's a faithful answer, e.g. "How did you hear about us?").
 */
export function matchText(value: string, field: FormField, opts: { allowOther?: boolean } = {}): OptionMatch {
  const options = field.options ?? [];
  const v = n(value);
  const exact = options.filter((o) => n(o.label) === v || n(o.value) === v);
  if (exact.length === 1) return { ok: true, options: exact, reason: "Exact match" };
  const contains = options.filter((o) => {
    const l = n(o.label);
    return l.length > 1 && (l.includes(v) || v.includes(l));
  });
  if (contains.length === 1) return { ok: true, options: contains, reason: `“${value}” matches “${contains[0]!.label}”` };
  const vt = tokens(value);
  const scored = options
    .map((o) => {
      const ot = tokens(o.label);
      const inter = [...vt].filter((t) => ot.has(t)).length;
      return { o, score: inter / Math.max(1, Math.min(vt.size, ot.size)) };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  if (scored.length && (scored.length === 1 || scored[0]!.score > scored[1]!.score)) {
    return { ok: true, options: [scored[0]!.o], reason: `“${value}” is closest to “${scored[0]!.o.label}”` };
  }
  if (opts.allowOther) {
    const other = options.filter((o) => /^other\b/.test(n(o.label)));
    if (other.length === 1) return { ok: true, options: other, reason: `No closer option than “Other”` };
  }
  return { ok: false, reason: `No option matches “${value}”` };
}

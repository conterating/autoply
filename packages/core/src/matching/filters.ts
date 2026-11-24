import type { Field, Profile } from "../profile/schema.ts";

export type FilterablePosting = {
  company: string;
  title: string;
  location: string;
  workplaceType: "remote" | "hybrid" | "onsite" | "unknown";
  description: string;
  raw?: unknown;
};

export type FilterResult = { pass: boolean; reasons: string[] };

type Seniority = Profile["preferences"]["seniority"] extends Field<(infer S)[]> ? S : never;

/** The field's value only when the user confirmed it and it is non-empty. */
function confirmed<T>(f: Field<T>): T | undefined {
  if (!f.confirmedByUser || f.value === null || f.value === undefined) return undefined;
  if (Array.isArray(f.value) && f.value.length === 0) return undefined;
  return f.value;
}

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'");

function wordRe(term: string): RegExp {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
}

// ---------------------------------------------------------------- seniority

/** Candidate seniority levels implied by a title; empty when unknown. */
export function inferSeniority(title: string): Seniority[] {
  const t = norm(title);
  if (/\b(director|head of|vp|vice president)\b/.test(t)) return ["director"];
  if (/\b(engineering|eng|development|team|group|general|people|hiring|delivery) manager\b|\bmanager,? (of )?(engineering|software)\b/.test(t)) {
    return ["manager"];
  }
  if (/\bprincipal\b/.test(t)) return ["principal"];
  if (/\bstaff\b/.test(t)) return ["staff"];
  if (/\b(senior|sr\.?)(?=\W|$)/.test(t)) return ["senior"];
  if (/\blead\b/.test(t)) return ["senior", "staff"];
  if (/\b(intern|interns|internship|co-op|coop)\b/.test(t)) return ["intern"];
  if (/\b(new grad(uate)?|entry[- ]level|junior|jr\.?|associate|graduate)(?=\W|$)/.test(t)) return ["entry"];
  return [];
}

// ---------------------------------------------------------------- employment type

type Employment = Profile["preferences"]["employmentTypes"] extends Field<(infer E)[]> ? E : never;

export function inferEmploymentType(title: string): Employment | null {
  const t = norm(title);
  if (/\b(intern|interns|internship|co-op)\b/.test(t)) return "internship";
  if (/\b(contract|contractor|freelance)\b/.test(t)) return "contract";
  if (/\bpart[- ]time\b/.test(t)) return "part_time";
  if (/\b(temporary|temp)\b/.test(t)) return "temporary";
  return null;
}

// ---------------------------------------------------------------- locations and countries

const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut",
  de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan",
  mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
  nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio",
  ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota",
  tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia",
  wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([k, v]) => [v, k]));

/** Country name or code → ISO-ish code, for the countries we recognise. */
const COUNTRIES: Record<string, string> = {
  us: "US", usa: "US", "u.s.": "US", "u.s.a.": "US", "united states": "US", "united states of america": "US", america: "US",
  ca: "CA", canada: "CA",
  uk: "GB", gb: "GB", "united kingdom": "GB", england: "GB", "great britain": "GB",
  in: "IN", india: "IN",
  de: "DE", germany: "DE",
  fr: "FR", france: "FR",
  ie: "IE", ireland: "IE",
  nl: "NL", netherlands: "NL",
  au: "AU", australia: "AU",
  sg: "SG", singapore: "SG",
  es: "ES", spain: "ES",
  pl: "PL", poland: "PL",
  br: "BR", brazil: "BR",
  mx: "MX", mexico: "MX",
  jp: "JP", japan: "JP",
  il: "IL", israel: "IL",
};

export function countryCode(name: string): string | null {
  return COUNTRIES[norm(name).trim()] ?? null;
}

/** Country named explicitly in a posting location (full names or unambiguous codes), if exactly one. */
function postingCountry(location: string): string | null {
  const found = new Set<string>();
  const t = norm(location);
  for (const [name, code] of Object.entries(COUNTRIES)) {
    if (name.length <= 3 && !["usa", "uk"].includes(name)) continue; // ambiguous short codes (CA, IN, ...)
    if (wordRe(name).test(t)) found.add(code);
  }
  return found.size === 1 ? [...found][0]! : null;
}

function locationTokens(userLocation: string): string[] {
  const tokens = userLocation
    .split(/[,;/]/)
    .map((s) => norm(s).trim())
    .filter((s) => s.length >= 2);
  const extra: string[] = [];
  for (const t of tokens) {
    if (US_STATES[t]) extra.push(US_STATES[t]!);
    if (STATE_BY_NAME[t]) extra.push(STATE_BY_NAME[t]!);
    const c = countryCode(t);
    if (c === "US") extra.push("united states", "usa", "us");
  }
  return [...tokens, ...extra];
}

// ---------------------------------------------------------------- salary

function parseAmount(raw: string): number | null {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?$/.exec(raw.trim());
  if (!m) return null;
  let n = Number(m[1]!.replace(/,/g, ""));
  if (m[2]) n *= 1000;
  return n >= 1000 ? n : null; // ignore hourly figures
}

/** Highest annual USD maximum found in the posting text (or Lever's salaryRange), or null. */
export function maxSalary(posting: FilterablePosting): number | null {
  const maxes: number[] = [];
  const amount = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s?[kK]?)`;
  const re = new RegExp(`${amount}\\s*(?:-|–|—|to)\\s*(?:\\$\\s?)?(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?\\s?[kK]?)`, "g");
  for (const m of posting.description.matchAll(re)) {
    const lo = parseAmount(m[1]!);
    const hi = parseAmount(m[2]!);
    if (lo !== null && hi !== null && hi >= lo) maxes.push(hi);
  }
  const raw = posting.raw as { salaryRange?: { currency?: string; interval?: string; max?: number } } | null | undefined;
  const sr = raw?.salaryRange;
  if (sr && typeof sr.max === "number" && (sr.currency ?? "USD") === "USD" && (sr.interval ?? "per-year-salary") === "per-year-salary") {
    maxes.push(sr.max);
  }
  return maxes.length ? Math.max(...maxes) : null;
}

// ---------------------------------------------------------------- sponsorship

const NEG = String.raw`(?:unable|not able|cannot|can't|can not|will not|won't|do not|does not|don't|doesn't|not)`;
const NO_SPONSORSHIP: RegExp[] = [
  new RegExp(String.raw`\b${NEG}\s+(?:to\s+)?(?:be able to\s+)?sponsor`),
  new RegExp(String.raw`\b${NEG}\s+(?:to\s+)?(?:offer|provide|support)\b[^.\n]{0,30}\bsponsorship`),
  /\bno\s+(?:visa\s+)?sponsorship/,
  /\bwithout\s+(?:the need for\s+)?(?:visa\s+)?sponsorship/,
  /\b(?:authorized|eligible)\b[^.\n]{0,80}\bwithout\b[^.\n]{0,40}\bsponsorship/,
];

export function saysNoSponsorship(description: string): boolean {
  const t = norm(description);
  return NO_SPONSORSHIP.some((re) => re.test(t));
}

// ---------------------------------------------------------------- hard filter

export function hardFilter(posting: FilterablePosting, profile: Profile): FilterResult {
  const reasons: string[] = [];
  const prefs = profile.preferences;
  const title = norm(posting.title);
  const text = norm(`${posting.title}\n${posting.description}`);

  // Excluded companies.
  const excludedCompanies = confirmed(prefs.excludedCompanies);
  if (excludedCompanies?.some((c) => norm(c).trim() === norm(posting.company).trim())) {
    reasons.push(`Company "${posting.company}" is on your excluded list`);
  }

  // Excluded keywords.
  const excludedKeywords = confirmed(prefs.excludedKeywords);
  for (const kw of excludedKeywords ?? []) {
    if (kw.trim() && wordRe(norm(kw)).test(text)) reasons.push(`Contains excluded keyword "${kw}"`);
  }

  // Seniority.
  const seniority = confirmed(prefs.seniority);
  if (seniority) {
    const inferred = inferSeniority(title);
    if (inferred.length && !inferred.some((s) => seniority.includes(s))) {
      reasons.push(`Seniority "${inferred.join("/")}" is not in your target levels`);
    }
  }

  // Workplace type.
  const workplaceTypes = confirmed(prefs.workplaceTypes);
  const acceptsRemote = workplaceTypes?.includes("remote") ?? false;
  const isRemote = posting.workplaceType === "remote";
  if (workplaceTypes && posting.workplaceType !== "unknown" && !workplaceTypes.includes(posting.workplaceType)) {
    reasons.push(`Workplace type "${posting.workplaceType}" is not one you accept`);
  }

  // Location.
  const locations = confirmed(prefs.locations);
  const relocate = confirmed(prefs.willingToRelocate) === true;
  if (locations && !relocate && !(isRemote && acceptsRemote) && posting.location.trim()) {
    const loc = norm(posting.location);
    const match = locations.some((l) => locationTokens(l).some((tok) => wordRe(tok).test(loc)));
    if (!match) reasons.push(`Location "${posting.location}" does not match your locations`);
  }

  // Work authorization.
  const auth = profile.workAuthorization;
  const countries = confirmed(auth.authorizedCountries);
  const country = postingCountry(posting.location);
  if (countries && country) {
    const entry = countries.find((c) => countryCode(c.country) === country || c.country.toUpperCase() === country);
    if (entry && !entry.authorized) reasons.push(`You are not authorized to work in ${country}`);
  }
  const needsSponsorship = confirmed(auth.requiresSponsorshipNow) === true || confirmed(auth.requiresSponsorshipFuture) === true;
  if (needsSponsorship && saysNoSponsorship(posting.description)) {
    reasons.push("Posting does not offer visa sponsorship and you need it");
  }

  // Employment type.
  const employmentTypes = confirmed(prefs.employmentTypes);
  if (employmentTypes) {
    const kind = inferEmploymentType(title);
    if (kind && !employmentTypes.includes(kind)) reasons.push(`Employment type "${kind}" is not one you want`);
  }

  // Minimum salary.
  const minimum = confirmed(prefs.minimumSalary);
  const currency = confirmed(prefs.salaryCurrency) ?? "USD";
  if (minimum !== undefined && currency === "USD") {
    const max = maxSalary(posting);
    if (max !== null && max < minimum) reasons.push(`Top of salary range ($${max.toLocaleString("en-US")}) is below your minimum`);
  }

  return { pass: reasons.length === 0, reasons };
}

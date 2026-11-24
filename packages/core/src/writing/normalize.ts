/** Text normalization shared by fact-sheet building and claim checking. */

export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Very light stemmer, applied to both sides of every comparison. */
export function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function tokens(s: string): string[] {
  const n = norm(s);
  return n ? n.split(" ") : [];
}

const SKILL_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  postgres: "postgresql",
  golang: "go",
  k8s: "kubernetes",
  amazonwebservices: "aws",
  googlecloudplatform: "gcp",
  googlecloud: "gcp",
};

/** "Node.js", "NodeJS" and "Node" all become "node"; "Postgres" becomes "postgresql". */
export function normSkill(s: string): string {
  let v = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/c\+\+/g, "cpp")
    .replace(/c#/g, "csharp")
    .replace(/\.net\b/g, "dotnet")
    .replace(/[^a-z0-9]+/g, "");
  if (v.length > 4 && v.endsWith("js")) v = v.slice(0, -2);
  return SKILL_ALIASES[v] ?? v;
}

const GENERIC_ENTITY = new Set([
  "the", "of", "at", "and", "in", "for", "university", "college", "school", "institute",
  "inc", "llc", "ltd", "corp", "corporation", "co", "company", "group",
]);

function distinctive(s: string): string[] {
  return tokens(s).filter((t) => !GENERIC_ENTITY.has(t));
}

/** Equal after normalization, or one side's distinctive tokens are all contained in the other's. */
export function entitiesMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = distinctive(a);
  const tb = distinctive(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const sa = new Set(ta);
  const sb = new Set(tb);
  return ta.every((t) => sb.has(t)) || tb.every((t) => sa.has(t));
}

export function matchesAny(value: string, known: Iterable<string>): boolean {
  for (const k of known) if (entitiesMatch(value, k)) return true;
  return false;
}

/** All of `a`'s stemmed tokens appear in `b`'s (or the reverse). */
export function tokenSubset(a: string, b: string): boolean {
  const ta = tokens(a).map(stem);
  const tb = tokens(b).map(stem);
  if (ta.length === 0 || tb.length === 0) return false;
  const sa = new Set(ta);
  const sb = new Set(tb);
  return ta.every((t) => sb.has(t)) || tb.every((t) => sa.has(t));
}

// ------------------------------------------------------------------ numbers

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1_000_000, dozen: 12,
};
export const NUMBER_WORD_PATTERN = Object.keys(WORD_NUMBERS).join("|");

export function wordToNumber(w: string): number | null {
  return WORD_NUMBERS[w.toLowerCase()] ?? null;
}

export function normNumber(raw: string): string {
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : raw;
}

const URL_RE = /https?:\/\/\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|dev|ai|edu)\S*/gi;

/** Digit numbers in text (dates reduce to their year, URLs are ignored). `1,000` and `3.70` normalize. */
export function digitNumbers(text: string): string[] {
  const cleaned = text.replace(URL_RE, " ").replace(/\b(\d{4})-\d{2}(?:-\d{2})?\b/g, "$1");
  return [...cleaned.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => normNumber(m[0]));
}

/** Digit numbers plus spelled-out numbers (two..million; "one" is ignored as too idiomatic). */
export function allNumbers(text: string, opts: { includeOne?: boolean } = {}): string[] {
  const out = digitNumbers(text);
  const re = new RegExp(`\\b(${NUMBER_WORD_PATTERN})\\b`, "gi");
  for (const m of text.matchAll(re)) {
    const w = m[1]!.toLowerCase();
    if (w === "one" && !opts.includeOne) continue;
    out.push(String(WORD_NUMBERS[w]));
  }
  return out;
}

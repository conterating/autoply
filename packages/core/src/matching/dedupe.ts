const COUNTRY_SYNONYMS: [RegExp, string][] = [
  [/\bunited states of america\b/g, "us"],
  [/\bunited states\b/g, "us"],
  [/\bu\.s\.a?\.?(?=\W|$)/g, "us"],
  [/\busa\b/g, "us"],
  [/\bunited kingdom\b/g, "uk"],
];

function normalizePart(input: string): string {
  let s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ");
  for (const [re, to] of COUNTRY_SYNONYMS) s = s.replace(re, to);
  return s.replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Same algorithm as `dedupeKey` in `@autoply/ats` discovery (core cannot depend
 * on ats). Used when a posting arrives without a precomputed key.
 */
export function dedupeKey(company: string, title: string, location: string): string {
  return [company, title, location].map(normalizePart).join("|");
}

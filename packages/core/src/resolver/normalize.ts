/**
 * Normalizes a question label for matching and for Answer Bank keys:
 * lower-case, strip required markers and punctuation, collapse whitespace,
 * unify quotes and common abbreviations.
 */
export function normalizeQuestion(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\(\s*(required|optional)\s*\)/g, " ")
    .replace(/\*+/g, " ")
    .replace(/\be\.?g\.?\s/g, "eg ")
    .replace(/\bu\.s\.a?\.?/g, "us")
    .replace(/\bu\.s\b/g, "us")
    .replace(/&/g, " and ")
    .replace(/'s\b/g, "s")
    .replace(/[^a-z0-9+#/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

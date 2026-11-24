import type { NormalizedPosting } from "../types.ts";
import * as ashby from "./ashby.ts";
import type { BoardRef, DiscoveryOptions } from "./common.ts";
import * as greenhouse from "./greenhouse.ts";
import * as lever from "./lever.ts";

export type { BoardRef, DiscoveryOptions } from "./common.ts";
export { decodeEntities, htmlToText } from "./common.ts";
export { parseCommunityList, inferFromUrl, type CommunityPosting } from "./community.ts";
export { HttpError, RateLimiter, withBackoff, fetchJson, parseRetryAfter, defaultShouldRetry } from "./polite.ts";
export type { BackoffOptions, RateLimiterOptions } from "./polite.ts";
export { ashbyIdFromUrl } from "./ashby.ts";
export { greenhouse, lever, ashby };

export const DISCOVERABLE_ATS = ["greenhouse", "lever", "ashby"] as const;
export type DiscoverableAts = (typeof DISCOVERABLE_ATS)[number];

export function isDiscoverableAts(ats: string): ats is DiscoverableAts {
  return (DISCOVERABLE_ATS as readonly string[]).includes(ats);
}

export async function fetchSource(ats: string, board: BoardRef, opts: DiscoveryOptions = {}): Promise<NormalizedPosting[]> {
  switch (ats) {
    case "greenhouse":
      return greenhouse.fetchBoard(board, opts);
    case "lever":
      return lever.fetchBoard(board, opts);
    case "ashby":
      return ashby.fetchBoard(board, opts);
    default:
      throw new Error(`No discovery client for ATS "${ats}"`);
  }
}

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
  return s
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Second dedupe key (besides the ATS id): the same job syndicated through two
 * boards. Punctuation, case and separators are ignored, so "Remote - US",
 * "Remote (US)" and "Remote, United States" collide; anything else stays distinct.
 */
export function dedupeKey(company: string, title: string, location: string): string {
  return [company, title, location].map(normalizePart).join("|");
}

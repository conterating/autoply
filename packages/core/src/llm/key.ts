import { createHash } from "node:crypto";
import type { LlmTask } from "./types.ts";

/** JSON.stringify with sorted object keys, so equal inputs always hash equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Bump when a task's prompt changes in a way that should invalidate recordings.
 * Keys are task + version + hash of the semantic input.
 */
export const PROMPT_VERSIONS: Record<LlmTask, number> = {
  parse_resume: 1,
  classify_question: 1,
  score_relevance: 1,
  write_cover_letter: 1,
  write_answer: 1,
  extract_claims: 1,
};

export function replayKey(task: LlmTask, input: unknown): string {
  const h = createHash("sha256").update(stableStringify(input)).digest("hex").slice(0, 24);
  return `v${PROMPT_VERSIONS[task]}-${h}`;
}

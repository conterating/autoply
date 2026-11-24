import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export const LLM_TASKS = [
  "parse_resume",
  "classify_question",
  "score_relevance",
  "write_cover_letter",
  "write_answer",
  "extract_claims",
] as const;
export type LlmTask = (typeof LLM_TASKS)[number];

/** Which configured model a task uses (see Settings.models). */
export const TASK_MODEL: Record<LlmTask, "classify" | "write" | "parse"> = {
  parse_resume: "parse",
  classify_question: "classify",
  score_relevance: "classify",
  write_cover_letter: "write",
  write_answer: "write",
  extract_claims: "classify",
};

export type LlmContent = string | Anthropic.Beta.BetaContentBlockParam[];

export type StructuredRequest<S extends z.ZodType> = {
  task: LlmTask;
  system: string;
  content: LlmContent;
  schema: S;
  /**
   * The semantic input that determines the answer, used as the replay key.
   * Must be JSON-serializable and stable (no timestamps).
   */
  replayKey: unknown;
  maxTokens?: number;
};

export interface Llm {
  readonly mode: "live" | "replay" | "record";
  structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>>;
}

export class LlmUnavailableError extends Error {
  constructor(message = "No Claude API key is configured. Add one in Settings or set ANTHROPIC_API_KEY.") {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export class LlmRefusalError extends Error {
  constructor(readonly task: LlmTask, readonly category: string | null) {
    super(`Claude declined the ${task} request${category ? ` (${category})` : ""}.`);
    this.name = "LlmRefusalError";
  }
}

export class ReplayMissError extends Error {
  constructor(readonly task: LlmTask, readonly key: string, readonly file: string) {
    super(`No recorded LLM response for ${task} (${key}). Expected ${file}. Re-record with AUTOPLY_LLM_MODE=record.`);
    this.name = "ReplayMissError";
  }
}

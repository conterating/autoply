import { join, resolve } from "node:path";
import { getApiKey } from "../secrets.ts";
import type { Settings } from "../settings.ts";
import { AnthropicLlm } from "./anthropic.ts";
import { RecordingLlm, ReplayLlm } from "./replay.ts";
import { LlmUnavailableError, type Llm } from "./types.ts";

export * from "./types.ts";
export * from "./key.ts";
export { AnthropicLlm } from "./anthropic.ts";
export { FakeLlm, RecordingLlm, ReplayLlm } from "./replay.ts";

export type LlmMode = "live" | "replay" | "record";

export function llmMode(): LlmMode {
  const m = process.env.AUTOPLY_LLM_MODE;
  return m === "replay" || m === "record" ? m : "live";
}

export function fixturesDir(): string {
  return resolve(process.env.AUTOPLY_LLM_FIXTURES ?? join(process.cwd(), "tests", "fixtures", "llm"));
}

/**
 * Picks the LLM implementation:
 *   AUTOPLY_LLM_MODE=replay  → recorded responses only (CI, tests)
 *   AUTOPLY_LLM_MODE=record  → live API, saving each response as a recording
 *   otherwise                → live API (key from env, keychain, or `ant` profile)
 */
export async function createLlm(settings: Settings): Promise<Llm> {
  const mode = llmMode();
  if (mode === "replay") return new ReplayLlm(fixturesDir());
  const { key } = await getApiKey();
  const live = new AnthropicLlm(settings.models, key ?? undefined);
  return mode === "record" ? new RecordingLlm(live, fixturesDir()) : live;
}

/** True when a live call could plausibly succeed (or we're replaying). */
export async function llmAvailable(): Promise<boolean> {
  if (llmMode() === "replay") return true;
  const { key } = await getApiKey();
  return Boolean(key || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}

export { LlmUnavailableError };

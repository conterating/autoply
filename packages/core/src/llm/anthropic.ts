import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { Settings } from "../settings.ts";
import { LlmRefusalError, TASK_MODEL, type Llm, type StructuredRequest } from "./types.ts";

/** Models that accept the server-side refusal fallback parameter. */
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/**
 * Live Claude API client. Structured outputs go through `beta.messages.parse`
 * with a Zod output format, so every response is validated against the same
 * Zod schema the rest of the code uses.
 */
export class AnthropicLlm implements Llm {
  readonly mode = "live" as const;
  private readonly client: Anthropic;

  constructor(
    private readonly models: Settings["models"],
    apiKey?: string,
  ) {
    // Without an explicit key the SDK resolves env vars or an `ant auth login` profile.
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    const model = this.models[TASK_MODEL[req.task]];
    const content = typeof req.content === "string" ? [{ type: "text" as const, text: req.content }] : req.content;
    const response = await this.client.beta.messages.parse({
      model,
      max_tokens: req.maxTokens ?? 16000,
      // The system prompt is stable per task, so it caches across calls.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { format: betaZodOutputFormat(req.schema) },
      ...(FALLBACK_MODELS.has(model)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    });

    if (response.stop_reason === "refusal") {
      throw new LlmRefusalError(req.task, response.stop_details?.category ?? null);
    }
    if (response.parsed_output == null) {
      throw new Error(`Claude returned no parseable output for ${req.task} (stop_reason: ${response.stop_reason}).`);
    }
    return response.parsed_output as z.infer<S>;
  }
}

import { z } from "zod";

export const ModelSettingsSchema = z
  .object({
    /** Small, fast model: question classification, relevance scoring, claim extraction. */
    classify: z.string().min(1).default("claude-haiku-5-5"),
    /** Stronger model: cover letters and free-text answers. */
    write: z.string().min(1).default("claude-sonnet-5-5"),
    /** Resume parsing. */
    parse: z.string().min(1).default("claude-sonnet-5-5"),
  })
  .prefault({});

export const SettingsSchema = z.object({
  mode: z.enum(["review", "autopilot"]).default("review"),
  /** Stops before the submit click. Default until the user turns it off. */
  dryRun: z.boolean().default(true),
  dailyCap: z.number().int().min(1).max(500).default(50),
  /** Randomized pause between applications, in seconds. */
  pacing: z
    .object({
      minSeconds: z.number().min(0).default(45),
      maxSeconds: z.number().min(0).default(150),
    })
    .prefault({})
    .refine((p) => p.maxSeconds >= p.minSeconds, "Max pause must be at least the min pause"),
  /** Minimum requests interval per domain, in milliseconds. */
  perDomainMinIntervalMs: z.number().int().min(0).default(4000),
  /** Postings scoring below this are skipped. 0–100. */
  matchThreshold: z.number().min(0).max(100).default(60),
  /** Autopilot only submits when the match score is at least this. 0–100. */
  autopilotMatchThreshold: z.number().min(0).max(100).default(75),
  /** Resolver answers below this confidence go to Needs Input. 0–1. */
  answerConfidenceThreshold: z.number().min(0).max(1).default(0.85),
  discoveryIntervalMinutes: z.number().int().min(5).default(60),
  communityLists: z.array(z.url()).default([]),
  models: ModelSettingsSchema,
});

export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

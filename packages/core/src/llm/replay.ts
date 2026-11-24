import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { replayKey, stableStringify } from "./key.ts";
import { ReplayMissError, type Llm, type StructuredRequest } from "./types.ts";

type Recording = { task: string; key: string; input: unknown; output: unknown };

function fileFor(dir: string, task: string, key: string) {
  return join(dir, task, `${key}.json`);
}

/**
 * Serves recorded responses from `<dir>/<task>/<key>.json`. Used in CI and in
 * every test so no test depends on the live API. Outputs are still validated
 * against the request's Zod schema, so a stale recording fails loudly.
 */
export class ReplayLlm implements Llm {
  readonly mode = "replay" as const;
  constructor(private readonly dir: string) {}

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    const key = replayKey(req.task, req.replayKey);
    const file = fileFor(this.dir, req.task, key);
    if (!existsSync(file)) throw new ReplayMissError(req.task, key, file);
    const rec = JSON.parse(readFileSync(file, "utf8")) as Recording;
    return req.schema.parse(rec.output);
  }
}

/** Calls the live API and writes each response as a recording. */
export class RecordingLlm implements Llm {
  readonly mode = "record" as const;
  constructor(
    private readonly live: Llm,
    private readonly dir: string,
  ) {}

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    const output = await this.live.structured(req);
    const key = replayKey(req.task, req.replayKey);
    const file = fileFor(this.dir, req.task, key);
    mkdirSync(dirname(file), { recursive: true });
    const rec: Recording = { task: req.task, key, input: JSON.parse(stableStringify(req.replayKey)), output };
    writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
    return output;
  }
}

/** In-memory fake for unit tests: answers by task with a function of the replay key. */
export class FakeLlm implements Llm {
  readonly mode = "replay" as const;
  readonly calls: { task: string; replayKey: unknown }[] = [];
  constructor(private readonly handlers: Partial<Record<string, (input: unknown, req: StructuredRequest<z.ZodType>) => unknown>>) {}

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    this.calls.push({ task: req.task, replayKey: req.replayKey });
    const h = this.handlers[req.task];
    if (!h) throw new Error(`FakeLlm has no handler for ${req.task}`);
    return req.schema.parse(await h(req.replayKey, req as StructuredRequest<z.ZodType>));
  }
}

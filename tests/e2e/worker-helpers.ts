import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { getSettings, openDb, saveSettings, schema, type Db } from "../../packages/core/src/db/index.ts";

export const E2E_HOME = join(process.cwd(), ".test-data", "e2e");

/** Opens the same SQLite file the dashboard under test is using. */
export function e2eDb(): Db {
  return openDb(join(E2E_HOME, "autoply.db"));
}

export function seedSources(db: Db) {
  db.insert(schema.sources)
    .values([
      { ats: "greenhouse", boardToken: "northwind", companyName: "Northwind Labs" },
      { ats: "lever", boardToken: "contoso", companyName: "Contoso Systems" },
      { ats: "ashby", boardToken: "fabrikam", companyName: "Fabrikam AI" },
    ])
    .onConflictDoNothing()
    .run();
}

/** Test settings: no pacing delay, dry run as given. */
export function configure(db: Db, patch: { dryRun?: boolean; mode?: "review" | "autopilot"; dailyCap?: number }) {
  const s = getSettings(db);
  saveSettings(db, { ...s, pacing: { minSeconds: 0, maxSeconds: 0 }, ...patch });
}

export type WorkerHandle = { proc: ChildProcess; output: () => string; stop: (signal?: NodeJS.Signals) => Promise<void> };

/** Spawns the real worker process against the e2e data dir and the fixture server. */
export function spawnWorker(fixtureUrl: string, extraEnv: Record<string, string> = {}): WorkerHandle {
  let out = "";
  const proc = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: join(process.cwd(), "apps", "worker"),
    env: {
      ...process.env,
      AUTOPLY_HOME: E2E_HOME,
      AUTOPLY_TEST: "1",
      NODE_ENV: "test",
      AUTOPLY_LLM_MODE: "off",
      AUTOPLY_HEADLESS: "1",
      AUTOPLY_IDLE_MS: "300",
      AUTOPLY_DISCOVERY_BASE_URL: fixtureUrl,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (d) => (out += d));
  proc.stderr?.on("data", (d) => (out += d));
  return {
    proc,
    output: () => out,
    stop: (signal = "SIGTERM") =>
      new Promise((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.once("exit", () => resolve());
        proc.kill(signal);
      }),
  };
}

export async function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 60_000, intervalMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

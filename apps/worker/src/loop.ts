import { getDb, heartbeat, readWorkerState, type Db } from "@autoply/core/db";

export type TickResult = { didWork: boolean; summary: string };

/**
 * One pass of the pipeline. Discovery, matching, filling and submitting are
 * wired in as later milestones land; for now it reports that there is nothing
 * to do.
 */
export async function runOnce(_db: Db, _opts: { dryRun: boolean }): Promise<TickResult> {
  return { didWork: false, summary: "No queued applications." };
}

const HEARTBEAT_MS = 5_000;

export async function runWorker(opts: { signal?: AbortSignal } = {}) {
  const db = getDb();
  let activity = "Idle";
  heartbeat(db, process.pid, activity);
  const beat = setInterval(() => heartbeat(db, process.pid, activity), HEARTBEAT_MS);

  try {
    while (!opts.signal?.aborted) {
      const state = readWorkerState(db);
      if (state?.desired === "running") {
        activity = "Working";
        const result = await runOnce(db, { dryRun: true });
        activity = result.didWork ? result.summary : "Idle";
        if (!result.didWork) await sleep(HEARTBEAT_MS, opts.signal);
      } else {
        activity = "Paused";
        await sleep(1_000, opts.signal);
      }
    }
  } finally {
    clearInterval(beat);
    heartbeat(db, null, "Stopped");
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

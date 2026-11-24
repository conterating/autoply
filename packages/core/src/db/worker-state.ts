import type { Db } from "./index.ts";
import * as schema from "./schema.ts";
import { eq, sql } from "drizzle-orm";

const ROW = 1;
const nowSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export type WorkerDesired = "running" | "paused";

export function readWorkerState(db: Db) {
  return db.select().from(schema.workerState).where(eq(schema.workerState.id, ROW)).get() ?? null;
}

export function setDesired(db: Db, desired: WorkerDesired) {
  db.insert(schema.workerState)
    .values({ id: ROW, desired })
    .onConflictDoUpdate({ target: schema.workerState.id, set: { desired, updatedAt: nowSql } })
    .run();
}

export function heartbeat(db: Db, pid: number | null, activity: string | null) {
  db.insert(schema.workerState)
    .values({ id: ROW, pid, heartbeatAt: new Date().toISOString(), activity })
    .onConflictDoUpdate({
      target: schema.workerState.id,
      set: { pid, heartbeatAt: new Date().toISOString(), activity, updatedAt: nowSql },
    })
    .run();
}

/** A worker is alive if it heartbeated in the last `staleMs`. */
export function isWorkerAlive(state: { heartbeatAt: string | null; pid: number | null } | null, staleMs = 20_000) {
  if (!state?.heartbeatAt || !state.pid) return false;
  return Date.now() - Date.parse(state.heartbeatAt) < staleMs;
}

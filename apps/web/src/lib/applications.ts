import "server-only";
import { transition } from "@autoply/core/applications/transition";
import type { Db } from "@autoply/core/db";
import { schema } from "@autoply/core/db";
import { eq } from "drizzle-orm";

/** Puts applications that were waiting on answers back in the worker's queue. */
export function requeueApplications(db: Db, ids: number[], detail: string) {
  for (const id of ids) {
    const row = db.select({ status: schema.applications.status }).from(schema.applications).where(eq(schema.applications.id, id)).get();
    if (row?.status === "needs_input") transition(db, id, "queued", detail);
  }
}

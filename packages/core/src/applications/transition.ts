import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { applicationEvents, applications } from "../db/schema.ts";
import { assertTransition, type ApplicationStatus } from "./status.ts";

export type ApplicationPatch = Partial<Omit<typeof applications.$inferInsert, "id" | "postingId" | "status" | "createdAt">>;

export class ApplicationNotFoundError extends Error {
  constructor(readonly applicationId: number) {
    super(`Application ${applicationId} not found`);
    this.name = "ApplicationNotFoundError";
  }
}

/**
 * Moves an application to `to`, atomically: the current status is read inside
 * the transaction, the transition is asserted, the row is updated (with an
 * optional field patch) and an `application_events` row is written. If the
 * transition is invalid nothing is written and InvalidTransitionError is thrown.
 */
export function transition(
  db: Db,
  applicationId: number,
  to: ApplicationStatus,
  detail?: string | null,
  patch: ApplicationPatch = {},
): { from: ApplicationStatus; to: ApplicationStatus } {
  return db.transaction((tx) => {
    const row = tx.select({ status: applications.status }).from(applications).where(eq(applications.id, applicationId)).get();
    if (!row) throw new ApplicationNotFoundError(applicationId);
    assertTransition(row.status, to);
    tx.update(applications)
      .set({ ...patch, status: to, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` })
      .where(eq(applications.id, applicationId))
      .run();
    tx.insert(applicationEvents)
      .values({ applicationId, fromStatus: row.status, toStatus: to, detail: detail ?? null })
      .run();
    return { from: row.status, to };
  });
}

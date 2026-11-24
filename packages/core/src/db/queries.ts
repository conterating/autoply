import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { WAITING_ON_USER_STATUSES } from "../applications/status.ts";
import type { Db } from "./index.ts";
import { applicationEvents, applications, postings } from "./schema.ts";

export function startOfLocalDay(d = new Date()): string {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s.toISOString();
}

export function todayCounts(db: Db, since = startOfLocalDay()) {
  const found = db.select({ n: count() }).from(postings).where(gte(postings.discoveredAt, since)).get()?.n ?? 0;
  const applied =
    db.select({ n: count() }).from(applications).where(gte(applications.submittedAt, since)).get()?.n ?? 0;
  const waiting =
    db
      .select({ n: count() })
      .from(applications)
      .where(inArray(applications.status, [...WAITING_ON_USER_STATUSES]))
      .get()?.n ?? 0;
  const failed =
    db
      .select({ n: count() })
      .from(applicationEvents)
      .where(and(eq(applicationEvents.toStatus, "failed"), gte(applicationEvents.at, since)))
      .get()?.n ?? 0;
  return { found, applied, waiting, failed };
}

/** Submissions that count against today's cap (dry runs don't). */
export function submittedToday(db: Db, since = startOfLocalDay()): number {
  return (
    db
      .select({ n: count() })
      .from(applications)
      .where(and(gte(applications.submittedAt, since), eq(applications.dryRun, false)))
      .get()?.n ?? 0
  );
}

export function recentActivity(db: Db, limit = 12) {
  return db
    .select({
      id: applicationEvents.id,
      applicationId: applicationEvents.applicationId,
      fromStatus: applicationEvents.fromStatus,
      toStatus: applicationEvents.toStatus,
      detail: applicationEvents.detail,
      at: applicationEvents.at,
      company: postings.company,
      title: postings.title,
    })
    .from(applicationEvents)
    .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
    .innerJoin(postings, eq(postings.id, applications.postingId))
    .orderBy(desc(applicationEvents.id))
    .limit(limit)
    .all();
}

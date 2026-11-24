import { and, eq, isNull, or, sql } from "drizzle-orm";
import { transition } from "../applications/transition.ts";
import type { Db } from "../db/index.ts";
import { ATS_KINDS, applicationEvents, applications, postings } from "../db/schema.ts";
import type { Llm } from "../llm/types.ts";
import type { Profile } from "../profile/schema.ts";
import type { Settings } from "../settings.ts";
import { dedupeKey as computeDedupeKey } from "./dedupe.ts";
import { hardFilter } from "./filters.ts";
import { profileSummary, scoreRelevance } from "./score.ts";

/** Structurally compatible with `NormalizedPosting` from `@autoply/ats`. */
export type IngestPosting = {
  ats: string;
  externalId: string;
  company: string;
  title: string;
  location: string;
  workplaceType: "remote" | "hybrid" | "onsite" | "unknown";
  url: string;
  applyUrl: string;
  description: string;
  postedAt: string | null;
  raw?: unknown;
  dedupeKey?: string;
};

export type PostingRow = typeof postings.$inferSelect;

/**
 * Inserts postings that are new by (ats, external_id) and by dedupe key.
 * Existing rows are left untouched, so re-ingesting is idempotent.
 */
export function ingestPostings(db: Db, sourceId: number | null, incoming: IngestPosting[]): PostingRow[] {
  const inserted: PostingRow[] = [];
  db.transaction((tx) => {
    for (const p of incoming) {
      if (!(ATS_KINDS as readonly string[]).includes(p.ats)) continue;
      const row = tx
        .insert(postings)
        .values({
          ats: p.ats as (typeof ATS_KINDS)[number],
          externalId: p.externalId,
          sourceId,
          company: p.company,
          title: p.title,
          location: p.location,
          workplaceType: p.workplaceType,
          url: p.url,
          applyUrl: p.applyUrl,
          description: p.description,
          postedAt: p.postedAt,
          dedupeKey: p.dedupeKey ?? computeDedupeKey(p.company, p.title, p.location),
          raw: p.raw ?? null,
        })
        // Covers both unique indexes: (ats, external_id) and dedupe_key.
        .onConflictDoNothing()
        .returning()
        .get();
      if (row) inserted.push(row);
    }
  });
  return inserted;
}

export type MatchSummary = { processed: number; skipped: number; queued: number; errors: number };

/**
 * Creates an application for every posting that has none (and retries those
 * still `discovered` after an LLM failure), then hard-filters and scores.
 */
export async function matchNewPostings(
  db: Db,
  ctx: { llm: Llm; profile: Profile; settings: Settings },
): Promise<MatchSummary> {
  const { llm, profile, settings } = ctx;
  const todo = db
    .select({ posting: postings, applicationId: applications.id })
    .from(postings)
    .leftJoin(applications, eq(applications.postingId, postings.id))
    .where(and(isNull(postings.closedAt), or(isNull(applications.id), eq(applications.status, "discovered"))))
    .orderBy(postings.id)
    .all();

  const summary: MatchSummary = { processed: 0, skipped: 0, queued: 0, errors: 0 };
  const profileText = profileSummary(profile);

  for (const { posting, applicationId: existingId } of todo) {
    let applicationId = existingId;
    if (applicationId === null) {
      applicationId = db.transaction((tx) => {
        const created = tx
          .insert(applications)
          .values({ postingId: posting.id, status: "discovered", dryRun: settings.dryRun })
          .onConflictDoNothing()
          .returning({ id: applications.id })
          .get();
        if (!created) return null;
        tx.insert(applicationEvents)
          .values({ applicationId: created.id, fromStatus: null, toStatus: "discovered", detail: "Posting ingested" })
          .run();
        return created.id;
      });
      if (applicationId === null) continue;
    }
    summary.processed++;

    const filter = hardFilter(posting, profile);
    if (!filter.pass) {
      const reason = filter.reasons.join("; ");
      transition(db, applicationId, "skipped", `Hard filter: ${reason}`, { matchReason: reason, lastError: null });
      summary.skipped++;
      continue;
    }

    let result;
    try {
      result = await scoreRelevance(llm, { posting, profileSummary: profileText });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.update(applications)
        .set({ lastError: `Scoring failed: ${message}`, attempts: sql`${applications.attempts} + 1` })
        .where(eq(applications.id, applicationId))
        .run();
      summary.errors++;
      continue;
    }

    const patch = { matchScore: result.score, matchReason: result.reason, lastError: null };
    if (result.score >= settings.matchThreshold) {
      transition(db, applicationId, "matched", `Score ${result.score}: ${result.reason}`, patch);
      transition(db, applicationId, "queued", "Queued for filling");
      summary.queued++;
    } else {
      transition(db, applicationId, "skipped", `Score ${result.score} below threshold ${settings.matchThreshold}: ${result.reason}`, patch);
      summary.skipped++;
    }
  }
  return summary;
}

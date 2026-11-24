import { randomUUID } from "node:crypto";
import { fetchSource, parseCommunityList, type AtsAdapter, type DiscoveryOptions } from "@autoply/ats";
import { getDb, getProfile, getSettings, heartbeat, readWorkerState, schema, type Db } from "@autoply/core/db";
import { createLlm, llmAvailable, type Llm } from "@autoply/core/llm";
import { ingestPostings, matchNewPostings } from "@autoply/core/matching";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { BrowserContext, Page } from "playwright";
import { canSubmit, prepareApplication, recoverInterrupted, submitApplication, type ApplyDeps, type StepOutcome } from "./apply.ts";
import { openBrowser } from "./browser.ts";

export type TickResult = { didWork: boolean; summary: string; outcomes: StepOutcome[] };

export type WorkerDeps = {
  db: Db;
  adapters: Record<string, AtsAdapter>;
  newPage: () => Promise<Page>;
  llm: Llm | null;
  workerId: string;
  discovery?: DiscoveryOptions;
  now?: () => Date;
  keepBlockedPagesOpen?: boolean;
};

const communityPolledAt = new Map<string, number>();

/**
 * Community job lists (e.g. the new-grad lists on GitHub) are a source of
 * company boards: every Greenhouse/Lever/Ashby board they link to becomes a
 * source, and the normal board polling fetches its postings.
 */
export async function syncCommunityLists(deps: WorkerDeps, opts: { force?: boolean } = {}) {
  const { db } = deps;
  const settings = getSettings(db);
  const now = (deps.now ?? (() => new Date()))().getTime();
  const fetchFn = deps.discovery?.fetch ?? fetch;
  let added = 0;
  for (const url of settings.communityLists) {
    const last = communityPolledAt.get(url) ?? 0;
    if (!opts.force && now - last < settings.discoveryIntervalMinutes * 60_000) continue;
    communityPolledAt.set(url, now);
    try {
      const res = await fetchFn(url);
      if (!res.ok) continue;
      const boards = new Map<string, { ats: "greenhouse" | "lever" | "ashby"; boardToken: string; companyName: string }>();
      for (const row of parseCommunityList(await res.text())) boards.set(`${row.ats}:${row.boardToken}`, { ats: row.ats, boardToken: row.boardToken, companyName: row.company });
      for (const b of boards.values()) {
        const r = db.insert(schema.sources).values(b).onConflictDoNothing().run();
        added += r.changes;
      }
    } catch {
      // A list being unreachable shouldn't stop discovery; it's retried next interval.
    }
  }
  return added;
}

/** Polls sources whose last poll is older than the discovery interval, then matches new postings. */
export async function discover(deps: WorkerDeps, opts: { force?: boolean } = {}) {
  const { db } = deps;
  const settings = getSettings(db);
  const now = (deps.now ?? (() => new Date()))();
  await syncCommunityLists(deps, opts);
  const sources = db.select().from(schema.sources).where(eq(schema.sources.enabled, true)).all();
  let found = 0;
  for (const s of sources) {
    const due = opts.force || !s.lastPolledAt || now.getTime() - Date.parse(s.lastPolledAt) >= settings.discoveryIntervalMinutes * 60_000;
    if (!due) continue;
    try {
      const postings = await fetchSource(s.ats, { boardToken: s.boardToken, companyName: s.companyName }, deps.discovery ?? {});
      found += ingestPostings(db, s.id, postings).length;
      db.update(schema.sources).set({ lastPolledAt: now.toISOString(), lastError: null }).where(eq(schema.sources.id, s.id)).run();
    } catch (e) {
      db.update(schema.sources)
        .set({ lastPolledAt: now.toISOString(), lastError: e instanceof Error ? e.message : String(e) })
        .where(eq(schema.sources.id, s.id))
        .run();
    }
  }
  const profile = getProfile(db);
  // Only match once onboarding is done; otherwise every posting would be scored against an empty profile.
  const matched = profile.onboarding.completedAt ? await matchNewPostings(db, { llm: deps.llm, profile, settings }) : null;
  return { found, matched };
}

/**
 * One pass: recover → discover (when due) → submit one approved/autopilot
 * application → otherwise prepare one queued application.
 */
export async function runOnce(deps: WorkerDeps, opts: { dryRun?: boolean; discover?: boolean } = {}): Promise<TickResult> {
  const { db } = deps;
  const outcomes: StepOutcome[] = [];
  const recovered = recoverInterrupted(db, (deps.now ?? (() => new Date()))());
  const parts: string[] = [];
  if (recovered.reclaimed || recovered.flagged) parts.push(`Recovered ${recovered.reclaimed + recovered.flagged} interrupted`);

  if (opts.discover !== false) {
    const d = await discover(deps);
    if (d.found) parts.push(`Found ${d.found} new ${d.found === 1 ? "job" : "jobs"}`);
    if (d.matched?.queued) parts.push(`Queued ${d.matched.queued}`);
  }

  const applyDeps: ApplyDeps = { ...deps };
  const settings = getSettings(db);
  const dryRun = opts.dryRun ?? settings.dryRun;

  // Submit first: approved (review) or autopilot-eligible, oldest first.
  const ready = db
    .select({ id: schema.applications.id })
    .from(schema.applications)
    .where(eq(schema.applications.status, "ready"))
    .orderBy(asc(schema.applications.approvedAt), asc(schema.applications.updatedAt))
    .all();
  for (const r of ready) {
    if (!canSubmit(db, r.id, { dryRun }).ok) continue;
    const o = await submitApplication(applyDeps, r.id);
    outcomes.push(o);
    parts.push(`${o.status === "confirmed" || o.status === "submitted" ? "Sent" : o.status} #${o.applicationId}`);
    return { didWork: true, summary: parts.join(" · "), outcomes };
  }

  const next = db
    .select({ id: schema.applications.id })
    .from(schema.applications)
    .where(eq(schema.applications.status, "queued"))
    .orderBy(asc(schema.applications.updatedAt))
    .get();
  if (next) {
    const o = await prepareApplication(applyDeps, next.id);
    outcomes.push(o);
    parts.push(`Prepared #${o.applicationId}: ${o.status}`);
    return { didWork: true, summary: parts.join(" · "), outcomes };
  }
  return { didWork: parts.length > 0, summary: parts.join(" · ") || "Nothing to do.", outcomes };
}

/** Number of approved applications waiting to be sent (used for status). */
export function approvedWaiting(db: Db) {
  return db
    .select({ id: schema.applications.id })
    .from(schema.applications)
    .where(and(eq(schema.applications.status, "ready"), isNotNull(schema.applications.approvedAt)))
    .all().length;
}

/** Tests point discovery at the fixture server with AUTOPLY_DISCOVERY_BASE_URL. */
export function discoveryOptionsFromEnv(): DiscoveryOptions {
  const baseUrl = process.env.AUTOPLY_DISCOVERY_BASE_URL;
  return baseUrl ? { baseUrl, backoff: { retries: 0 } } : {};
}

function randomBetween(minS: number, maxS: number) {
  return (minS + Math.random() * Math.max(0, maxS - minS)) * 1000;
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

const HEARTBEAT_MS = 5_000;

export async function runWorker(opts: { signal?: AbortSignal; adapters: Record<string, AtsAdapter>; headless?: boolean }) {
  const db = getDb();
  const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  let activity = "Idle";
  heartbeat(db, process.pid, activity);
  const beat = setInterval(() => heartbeat(db, process.pid, activity), HEARTBEAT_MS);
  // A crash leaves `filling` rows with a lease; a fresh worker reclaims them all.
  recoverInterrupted(db, new Date(), { includeLive: true });

  let context: BrowserContext | null = null;
  const newPage = async () => {
    context ??= await openBrowser({ headless: opts.headless });
    return context.newPage();
  };

  try {
    while (!opts.signal?.aborted) {
      const state = readWorkerState(db);
      if (state?.desired !== "running") {
        activity = "Paused";
        await sleep(Math.min(1_000, Number(process.env.AUTOPLY_IDLE_MS ?? 1_000)), opts.signal);
        continue;
      }
      activity = "Working";
      const llm = (await llmAvailable()) ? await createLlm(getSettings(db)) : null;
      const result = await runOnce({ db, adapters: opts.adapters, newPage, llm, workerId, keepBlockedPagesOpen: true, discovery: discoveryOptionsFromEnv() });
      activity = result.didWork ? result.summary : "Idle";
      const settings = getSettings(db);
      // Human-scale pacing between applications; a short idle poll otherwise.
      const idleMs = Number(process.env.AUTOPLY_IDLE_MS ?? 15_000);
      await sleep(result.outcomes.length ? randomBetween(settings.pacing.minSeconds, settings.pacing.maxSeconds) : idleMs, opts.signal);
    }
  } finally {
    clearInterval(beat);
    heartbeat(db, null, "Stopped");
    await (context as BrowserContext | null)?.close().catch(() => {});
  }
}

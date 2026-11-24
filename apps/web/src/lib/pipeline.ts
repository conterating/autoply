import "server-only";
import { schema, type Db } from "@autoply/core/db";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@autoply/core";
import { and, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";

export const PAGE_SIZE = 50;

export const STATUS_PRESETS = [
  { id: "all", label: "All", statuses: [] as ApplicationStatus[] },
  { id: "waiting", label: "Waiting on you", statuses: ["needs_input", "needs_user", "ready"] as ApplicationStatus[] },
  { id: "sent", label: "Sent", statuses: ["submitted", "confirmed"] as ApplicationStatus[] },
  { id: "skipped", label: "Skipped", statuses: ["skipped"] as ApplicationStatus[] },
  { id: "failed", label: "Failed", statuses: ["failed"] as ApplicationStatus[] },
] as const;

export type PipelineFilters = { statuses: ApplicationStatus[]; q: string; ats: string; page: number };

type Params = Record<string, string | string[] | undefined>;

function list(v: string | string[] | undefined): string[] {
  return (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
}

export function parseFilters(params: Params): PipelineFilters {
  const known = new Set<string>(APPLICATION_STATUSES);
  const statuses = [...new Set(list(params.status).filter((s) => known.has(s)))] as ApplicationStatus[];
  const q = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim().slice(0, 100) ?? "";
  const ats = (Array.isArray(params.ats) ? params.ats[0] : params.ats)?.trim() ?? "";
  const page = Math.max(1, Math.floor(Number(Array.isArray(params.page) ? params.page[0] : params.page)) || 1);
  return { statuses, q, ats, page };
}

/** Which preset (if any) exactly matches the selected statuses. */
export function activePreset(statuses: ApplicationStatus[]) {
  return (
    STATUS_PRESETS.find((p) => p.statuses.length === statuses.length && p.statuses.every((s) => statuses.includes(s)))?.id ?? null
  );
}

export function pipelineHref(f: Partial<PipelineFilters>) {
  const sp = new URLSearchParams();
  for (const s of f.statuses ?? []) sp.append("status", s);
  if (f.q) sp.set("q", f.q);
  if (f.ats) sp.set("ats", f.ats);
  if (f.page && f.page > 1) sp.set("page", String(f.page));
  const qs = sp.toString();
  return qs ? `/pipeline?${qs}` : "/pipeline";
}

export type PipelineRow = {
  id: number;
  status: ApplicationStatus;
  company: string;
  title: string;
  location: string;
  matchScore: number | null;
  matchReason: string | null;
  ats: string;
  updatedAt: string;
  pendingAnswers: number;
};

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function queryPipeline(db: Db, f: PipelineFilters) {
  const { applications: a, postings: p, applicationAnswers: ans } = schema;
  const conds: SQL[] = [];
  if (f.statuses.length) conds.push(inArray(a.status, f.statuses));
  if (f.ats) conds.push(eq(p.ats, f.ats as never));
  if (f.q) {
    const pat = `%${escapeLike(f.q.toLowerCase())}%`;
    conds.push(or(sql`lower(${p.company}) like ${pat} escape '\\'`, sql`lower(${p.title}) like ${pat} escape '\\'`)!);
  }
  const where = conds.length ? and(...conds) : undefined;

  const total = db.select({ n: count() }).from(a).innerJoin(p, eq(p.id, a.postingId)).where(where).get()?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const rows = db
    .select({
      id: a.id,
      status: a.status,
      company: p.company,
      title: p.title,
      location: p.location,
      matchScore: a.matchScore,
      matchReason: a.matchReason,
      ats: p.ats,
      updatedAt: a.updatedAt,
      pendingAnswers: sql<number>`(select count(*) from ${ans} where ${ans.applicationId} = ${a.id} and ${ans.pending} = 1)`,
    })
    .from(a)
    .innerJoin(p, eq(p.id, a.postingId))
    .where(where)
    .orderBy(desc(a.updatedAt), desc(a.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
    .all() as PipelineRow[];
  const everything = db.select({ n: count() }).from(a).get()?.n ?? 0;
  const atsOptions = db.selectDistinct({ ats: p.ats }).from(p).innerJoin(a, eq(a.postingId, p.id)).all().map((r) => r.ats);
  return { rows, total, page, pages, everything, atsOptions };
}

import { z } from "zod";
import type { NormalizedPosting } from "../types.ts";
import { fetchJsonFor, htmlToText, resolveUrl, workplaceFromText, type BoardRef, type DiscoveryOptions, type WorkplaceType } from "./common.ts";

export const ASHBY_REAL_BASE = "https://api.ashbyhq.com";
export const ASHBY_FIXTURE_PREFIX = "/ashby";

const BoardSchema = z.object({ jobs: z.array(z.unknown()) });

const JobSchema = z.object({
  title: z.string().min(1),
  location: z.string().nullish(),
  isListed: z.boolean().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  publishedAt: z.string().nullish(),
  jobUrl: z.string().min(1),
  applyUrl: z.string().nullish(),
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Ashby documents no job id; the UUID in the job URL is the stable identifier. */
export function ashbyIdFromUrl(jobUrl: string): string | null {
  const m = UUID.exec(jobUrl);
  if (m) return m[0].toLowerCase();
  try {
    const last = new URL(jobUrl).pathname.split("/").filter(Boolean).pop();
    return last ?? null;
  } catch {
    return null;
  }
}

function workplace(job: z.infer<typeof JobSchema>, location: string): WorkplaceType {
  switch (job.workplaceType) {
    case "OnSite":
      return "onsite";
    case "Remote":
      return "remote";
    case "Hybrid":
      return "hybrid";
    default:
      return job.isRemote ? "remote" : workplaceFromText(location);
  }
}

export async function fetchBoard(board: BoardRef, opts: DiscoveryOptions = {}): Promise<NormalizedPosting[]> {
  const url = resolveUrl(
    opts,
    ASHBY_REAL_BASE,
    ASHBY_FIXTURE_PREFIX,
    `/posting-api/job-board/${encodeURIComponent(board.boardToken)}?includeCompensation=true`,
  );
  const body = BoardSchema.parse(await fetchJsonFor(url, opts));
  const out: NormalizedPosting[] = [];
  for (const raw of body.jobs) {
    const parsed = JobSchema.safeParse(raw);
    if (!parsed.success) continue;
    const job = parsed.data;
    if (job.isListed === false) continue;
    const externalId = ashbyIdFromUrl(job.jobUrl);
    if (!externalId) continue;
    const location = (job.location ?? "").trim();
    out.push({
      ats: "ashby",
      externalId,
      company: board.companyName,
      title: job.title.trim(),
      location,
      workplaceType: workplace(job, location),
      url: job.jobUrl,
      applyUrl: job.applyUrl || `${job.jobUrl.replace(/\/+$/, "")}/application`,
      description: job.descriptionPlain?.trim() || htmlToText(job.descriptionHtml ?? ""),
      postedAt: job.publishedAt ?? null,
      raw,
    });
  }
  return out;
}

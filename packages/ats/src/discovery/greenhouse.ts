import { z } from "zod";
import type { NormalizedPosting } from "../types.ts";
import { decodeEntities, fetchJsonFor, htmlToText, resolveUrl, workplaceFromText, type BoardRef, type DiscoveryOptions } from "./common.ts";

export const GREENHOUSE_REAL_BASE = "https://boards-api.greenhouse.io";
export const GREENHOUSE_FIXTURE_PREFIX = "/greenhouse/boards-api";

const BoardSchema = z.object({ jobs: z.array(z.unknown()) });

const JobSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().min(1),
  updated_at: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  absolute_url: z.string().min(1),
  content: z.string().nullish(),
});

export async function fetchBoard(board: BoardRef, opts: DiscoveryOptions = {}): Promise<NormalizedPosting[]> {
  const url = resolveUrl(
    opts,
    GREENHOUSE_REAL_BASE,
    GREENHOUSE_FIXTURE_PREFIX,
    `/v1/boards/${encodeURIComponent(board.boardToken)}/jobs?content=true`,
  );
  const body = BoardSchema.parse(await fetchJsonFor(url, opts));
  const out: NormalizedPosting[] = [];
  for (const raw of body.jobs) {
    const parsed = JobSchema.safeParse(raw);
    if (!parsed.success) continue;
    const job = parsed.data;
    const location = (job.location?.name ?? "").trim();
    out.push({
      ats: "greenhouse",
      externalId: String(job.id),
      company: board.companyName,
      title: job.title.trim(),
      location,
      workplaceType: workplaceFromText(location),
      url: job.absolute_url,
      applyUrl: job.absolute_url,
      // `content` is HTML that was itself HTML-escaped: decode once, then strip tags.
      description: htmlToText(decodeEntities(job.content ?? "")),
      postedAt: job.updated_at ?? null,
      raw,
    });
  }
  return out;
}

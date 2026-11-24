import { z } from "zod";
import type { NormalizedPosting } from "../types.ts";
import { fetchJsonFor, htmlToText, resolveUrl, workplaceFromText, type BoardRef, type DiscoveryOptions, type WorkplaceType } from "./common.ts";

export const LEVER_REAL_BASE = "https://api.lever.co";
export const LEVER_FIXTURE_PREFIX = "/lever";

const JobSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
    })
    .nullish(),
  descriptionPlain: z.string().nullish(),
  additionalPlain: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  hostedUrl: z.string().min(1),
  applyUrl: z.string().nullish(),
  workplaceType: z.string().nullish(),
});

function workplace(type: string | null | undefined, location: string): WorkplaceType {
  switch (type) {
    case "on-site":
      return "onsite";
    case "remote":
      return "remote";
    case "hybrid":
      return "hybrid";
    default:
      return workplaceFromText(location);
  }
}

export async function fetchBoard(board: BoardRef, opts: DiscoveryOptions = {}): Promise<NormalizedPosting[]> {
  const url = resolveUrl(
    opts,
    LEVER_REAL_BASE,
    LEVER_FIXTURE_PREFIX,
    `/v0/postings/${encodeURIComponent(board.boardToken)}?mode=json`,
  );
  const body = z.array(z.unknown()).parse(await fetchJsonFor(url, opts));
  const out: NormalizedPosting[] = [];
  for (const raw of body) {
    const parsed = JobSchema.safeParse(raw);
    if (!parsed.success) continue;
    const job = parsed.data;
    const location = (job.categories?.location ?? job.categories?.allLocations?.join("; ") ?? "").trim();
    const sections = (job.lists ?? []).map((l) => `${l.text ?? ""}\n${htmlToText(l.content ?? "")}`.trim());
    const description = [job.descriptionPlain ?? "", ...sections, job.additionalPlain ?? ""]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n\n");
    out.push({
      ats: "lever",
      externalId: job.id,
      company: board.companyName,
      title: job.text.trim(),
      location,
      workplaceType: workplace(job.workplaceType, location),
      url: job.hostedUrl,
      applyUrl: job.applyUrl || `${job.hostedUrl.replace(/\/+$/, "")}/apply`,
      description,
      // `createdAt` is not documented, so Lever postings carry no date.
      postedAt: null,
      raw,
    });
  }
  return out;
}

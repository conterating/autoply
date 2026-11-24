import { createHash } from "node:crypto";
import { z } from "zod";
import type { Llm } from "../llm/types.ts";
import type { Profile } from "../profile/schema.ts";

export type ScorablePosting = {
  externalId: string;
  ats: string;
  title: string;
  company: string;
  location: string;
  description: string;
};

export type RelevanceScore = { score: number; reason: string };

const ScoreSchema = z.object({ score: z.number(), reason: z.string() });

const SYSTEM = `You judge how well a job posting fits a candidate.
Compare the candidate's confirmed experience, skills and target job titles with the job's requirements.
Score 0-100: 90+ is an excellent fit, 60-89 a plausible fit, below 40 a poor fit.
Give a reason of at most 25 words that is specific (name the matching or missing skills, level or domain).
Use only what is stated about the candidate; do not assume experience that is not listed.
Respond with JSON: { "score": number, "reason": string }.`;

const MAX_DESCRIPTION_CHARS = 8000;

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function limitWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? words.join(" ") : `${words.slice(0, max).join(" ")}…`;
}

export async function scoreRelevance(
  llm: Llm,
  input: { posting: ScorablePosting; profileSummary: string },
): Promise<RelevanceScore> {
  const { posting, profileSummary: summary } = input;
  const out = await llm.structured({
    task: "score_relevance",
    system: SYSTEM,
    content: [
      `CANDIDATE\n${summary}`,
      `JOB\nTitle: ${posting.title}\nCompany: ${posting.company}\nLocation: ${posting.location}\n\n${posting.description.slice(0, MAX_DESCRIPTION_CHARS)}`,
    ].join("\n\n"),
    schema: ScoreSchema,
    replayKey: {
      externalId: posting.externalId,
      ats: posting.ats,
      title: posting.title,
      company: posting.company,
      descriptionHash: sha(posting.description),
      profileSummary: summary,
    },
    maxTokens: 300,
  });
  return { score: Math.round(Math.min(100, Math.max(0, out.score))), reason: limitWords(out.reason, 25) };
}

/** Deterministic, confirmed-only text about the candidate. Never includes EEO, legal or contact data. */
export function profileSummary(profile: Profile): string {
  const lines: string[] = [];
  const prefs = profile.preferences;
  if (prefs.targetTitles.confirmedByUser && prefs.targetTitles.value?.length) {
    lines.push(`Target titles: ${prefs.targetTitles.value.join(", ")}`);
  }
  if (prefs.seniority.confirmedByUser && prefs.seniority.value?.length) {
    lines.push(`Seniority: ${prefs.seniority.value.join(", ")}`);
  }
  if (profile.skills.confirmedByUser && profile.skills.value?.length) {
    lines.push(`Skills: ${profile.skills.value.join(", ")}`);
  }
  const education = profile.education
    .filter((e) => e.confirmedByUser)
    .sort((a, b) => (b.graduationDate ?? b.startDate ?? "").localeCompare(a.graduationDate ?? a.startDate ?? ""))[0];
  if (education) {
    const what = [education.degree || education.degreeLevel, education.major && `in ${education.major}`].filter(Boolean).join(" ");
    lines.push(`Education: ${[what, `at ${education.school}`].filter(Boolean).join(" ")}`);
  }
  const jobs = profile.experience
    .filter((e) => e.confirmedByUser)
    .sort((a, b) => (b.endDate ?? "9999-99").localeCompare(a.endDate ?? "9999-99") || (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  if (jobs.length) {
    lines.push("Experience:");
    for (const j of jobs) {
      const span = `${j.startDate ?? "?"} to ${j.current ? "present" : (j.endDate ?? "?")}`;
      lines.push(`- ${j.title} at ${j.company} (${span})`);
    }
  }
  return lines.join("\n");
}

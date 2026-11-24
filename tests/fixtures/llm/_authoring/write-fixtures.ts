/**
 * Writes hand-authored LLM replay fixtures. These stand in for recordings
 * until they are re-recorded against the live API with AUTOPLY_LLM_MODE=record
 * (recorded files replace these; they share the same key format).
 *
 * Run: node tests/fixtures/llm/_authoring/write-fixtures.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { replayKey } from "../../../../packages/core/src/llm/key.ts";
import type { LlmTask } from "../../../../packages/core/src/llm/types.ts";

const root = join(import.meta.dirname, "..");
const resumes = join(import.meta.dirname, "..", "..", "resumes");

export function writeFixture(task: LlmTask, input: unknown, output: unknown) {
  const key = replayKey(task, input);
  const file = join(root, task, `${key}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ task, key, source: "hand-authored", input, output }, null, 2)}\n`);
  return file;
}

const sha = (f: string) => createHash("sha256").update(readFileSync(join(resumes, f))).digest("hex");

export const SAMPLE_PARSE = {
  firstName: "Jordan",
  middleName: null,
  lastName: "Rivera",
  email: "jordan.rivera@example.com",
  phone: "+1 (555) 010-4477",
  city: "Austin",
  state: "TX",
  country: "United States",
  linkedin: "https://linkedin.com/in/jordan-rivera-dev",
  github: "https://github.com/jrivera-dev",
  website: null,
  experience: [
    {
      company: "Northwind Labs",
      title: "Software Engineer Intern",
      location: "Austin, TX",
      startDate: "2025-05",
      endDate: "2025-08",
      current: false,
      bullets: [
        "Built a TypeScript service that cut report generation time from 40s to 6s.",
        "Added integration tests for the billing API, raising coverage from 52% to 81%.",
      ],
    },
    {
      company: "UT Austin Department of Computer Science",
      title: "Teaching Assistant",
      location: null,
      startDate: "2024-01",
      endDate: null,
      current: true,
      bullets: ["Lead weekly lab sections of 30 students for Data Structures."],
    },
  ],
  education: [
    {
      school: "University of Texas at Austin",
      degreeLevel: "bachelor",
      degree: "B.S. Computer Science",
      major: "Computer Science",
      minor: "Mathematics",
      gpa: 3.7,
      gpaScale: 4,
      startDate: null,
      graduationDate: "2026-05",
      graduationExpected: true,
      honors: ["Dean's List (2023, 2024)"],
    },
  ],
  skills: ["TypeScript", "Python", "React", "Node.js", "PostgreSQL", "Docker", "Git"],
  certifications: [],
  languages: [
    { language: "English", proficiency: "native" },
    { language: "Spanish", proficiency: "professional_working" },
  ],
  projects: [
    {
      name: "Trailhead",
      description: "Route planner for hikers built with React and PostgreSQL.",
      url: "https://trailhead.example.com",
    },
  ],
  publications: [],
};

for (const f of ["sample-resume.pdf", "sample-resume.docx"]) {
  console.log(writeFixture("parse_resume", { documentSha256: sha(f) }, SAMPLE_PARSE));
}

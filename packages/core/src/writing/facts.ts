import type { Profile } from "../profile/schema.ts";
import { digitNumbers, norm, normSkill, stem, tokens } from "./normalize.ts";

/** Normalized sets of everything the profile confirms, used to verify generated text. */
export type KnownFacts = {
  applicantName: string;
  employers: Set<string>;
  titles: Set<string>;
  schools: Set<string>;
  /** One normalized string per education entry: level + degree + major + minor. */
  degrees: Set<string>;
  skills: Set<string>;
  projects: Set<string>;
  certifications: Set<string>;
  /** Every number in the confirmed facts, normalized ("40s" and "40" are both "40"). */
  numbers: Set<string>;
  experienceMonths: number;
  educationMonths: number;
  factText: string;
  /** Stemmed tokens of the fact sheet. */
  factTokens: Set<string>;
};

export type FactSheet = { text: string; known: KnownFacts };

const LEVEL_WORDS: Record<string, string> = {
  high_school: "high school diploma",
  associate: "associate",
  bachelor: "bachelor",
  master: "master",
  mba: "mba master",
  phd: "phd doctorate",
  jd: "jd juris doctor",
  md: "md doctor of medicine",
  certificate: "certificate",
  bootcamp: "bootcamp",
};

function monthIndex(ym: string): number {
  const [y, m] = ym.split("-");
  return Number(y) * 12 + Number(m);
}

function nowMonth(): number {
  const d = new Date();
  return d.getFullYear() * 12 + d.getMonth() + 1;
}

function unionMonths(ranges: [number, number][]): number {
  const sorted = ranges.filter(([s, e]) => e >= s).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curEnd = -Infinity;
  for (const [s, e] of sorted) {
    const start = Math.max(s, curEnd + 1);
    if (e >= start) total += e - start + 1;
    curEnd = Math.max(curEnd, e);
  }
  return total;
}

export function applicantName(profile: Profile): string {
  const id = profile.identity;
  const first = id.preferredName.confirmedByUser && id.preferredName.value ? id.preferredName.value : id.legalFirstName.confirmedByUser ? id.legalFirstName.value : null;
  const last = id.legalLastName.confirmedByUser ? id.legalLastName.value : null;
  return [first, last].filter(Boolean).join(" ");
}

/**
 * A compact, deterministic plain-text summary of ONLY confirmed profile
 * facts, plus the structured KnownFacts used to check generated text against
 * it. Contact details, EEO, work authorization, screening and preference data
 * are deliberately never included.
 *
 * `documents` is accepted for API symmetry but not used: a resume's text may
 * contain entries the user has not confirmed, so it can never widen the facts.
 */
export function buildFactSheet(profile: Profile, documents?: { resumeText?: string }): FactSheet {
  void documents;
  const lines: string[] = [];
  const name = applicantName(profile);
  if (name) lines.push(`APPLICANT: ${name}`);

  const employers = new Set<string>();
  const titles = new Set<string>();
  const schools = new Set<string>();
  const degrees = new Set<string>();
  const skills = new Set<string>();
  const projects = new Set<string>();
  const certifications = new Set<string>();
  const expRanges: [number, number][] = [];
  const eduSpans: number[] = [];

  const exp = profile.experience.filter((e) => e.confirmedByUser);
  if (exp.length) {
    lines.push("", "EXPERIENCE:");
    for (const e of exp) {
      const when = e.startDate ? ` (${e.startDate} to ${e.current ? "present" : (e.endDate ?? e.startDate)})` : "";
      lines.push(`- ${e.title} at ${e.company}${e.location ? `, ${e.location}` : ""}${when}`);
      for (const b of e.bullets) lines.push(`  * ${b.trim()}`);
      employers.add(norm(e.company));
      titles.add(norm(e.title));
      if (e.startDate) {
        const end = e.current ? nowMonth() : monthIndex(e.endDate ?? e.startDate);
        expRanges.push([monthIndex(e.startDate), end]);
      }
    }
  }

  const edu = profile.education.filter((e) => e.confirmedByUser);
  if (edu.length) {
    lines.push("", "EDUCATION:");
    for (const e of edu) {
      const parts = [e.degree, e.major && !norm(e.degree).includes(norm(e.major)) ? `major in ${e.major}` : "", e.minor ? `minor in ${e.minor}` : ""].filter(Boolean);
      const gpa = e.gpa != null ? `, GPA ${e.gpa}/${e.gpaScale}` : "";
      const when = e.graduationDate ? `, ${e.graduationExpected ? "expected graduation" : "graduated"} ${e.graduationDate}` : "";
      const start = e.startDate ? `, started ${e.startDate}` : "";
      lines.push(`- ${parts.join(", ") || "Studies"}, ${e.school}${gpa}${start}${when}`);
      if (e.honors.length) lines.push(`  honors: ${e.honors.join("; ")}`);
      schools.add(norm(e.school));
      degrees.add(norm([e.degreeLevel ? (LEVEL_WORDS[e.degreeLevel] ?? "") : "", e.degree, e.major, e.minor].join(" ")));
      if (e.startDate && e.graduationDate) eduSpans.push(monthIndex(e.graduationDate) - monthIndex(e.startDate) + 1);
    }
  }

  const skillList = profile.skills.confirmedByUser ? (profile.skills.value ?? []) : [];
  if (skillList.length) {
    lines.push("", `SKILLS: ${skillList.join(", ")}`);
    for (const s of skillList) skills.add(normSkill(s));
  }

  const langs = profile.languages.filter((l) => l.confirmedByUser);
  if (langs.length) {
    lines.push("", `LANGUAGES: ${langs.map((l) => `${l.language} (${l.proficiency.replace(/_/g, " ")})`).join(", ")}`);
    for (const l of langs) skills.add(normSkill(l.language));
  }

  const certs = profile.certifications.filter((c) => c.confirmedByUser);
  if (certs.length) {
    lines.push("", "CERTIFICATIONS:");
    for (const c of certs) {
      lines.push(`- ${c.name}${c.issuer ? `, ${c.issuer}` : ""}${c.date ? ` (${c.date})` : ""}`);
      certifications.add(norm(c.name));
    }
  }

  const projs = profile.projects.filter((p) => p.confirmedByUser);
  if (projs.length) {
    lines.push("", "PROJECTS:");
    for (const p of projs) {
      lines.push(`- ${p.name}${p.description ? `: ${p.description}` : ""}${p.skills.length ? ` [${p.skills.join(", ")}]` : ""}`);
      projects.add(norm(p.name));
      for (const s of p.skills) skills.add(normSkill(s));
    }
  }

  const pubs = profile.publications.filter((p) => p.confirmedByUser);
  if (pubs.length) {
    lines.push("", "PUBLICATIONS:");
    for (const p of pubs) lines.push(`- ${p.title}${p.venue ? `, ${p.venue}` : ""}${p.date ? ` (${p.date})` : ""}`);
  }

  const links: string[] = [];
  const L = profile.links;
  for (const [label, f] of [["LinkedIn", L.linkedin], ["GitHub", L.github], ["Portfolio", L.portfolio], ["Website", L.website]] as const) {
    if (f.confirmedByUser && f.value) links.push(`${label}: ${f.value}`);
  }
  if (L.other.confirmedByUser) for (const o of L.other.value ?? []) links.push(`${o.label}: ${o.url}`);
  if (links.length) lines.push("", "LINKS:", ...links.map((l) => `- ${l}`));

  const text = lines.join("\n");
  return {
    text,
    known: {
      applicantName: name,
      employers,
      titles,
      schools,
      degrees,
      skills,
      projects,
      certifications,
      numbers: new Set(digitNumbers(text)),
      experienceMonths: unionMonths(expRanges),
      educationMonths: eduSpans.length ? Math.max(...eduSpans) : 0,
      factText: text,
      factTokens: new Set(tokens(text).map(stem)),
    },
  };
}

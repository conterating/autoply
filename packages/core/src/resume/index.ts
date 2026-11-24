import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Llm } from "../llm/types.ts";
import { DegreeLevel, LanguageProficiency, type Field, type Profile } from "../profile/schema.ts";

/**
 * What Claude extracts from a resume. Kept flat and permissive (nullable
 * strings, no regexes) so it fits structured-output constraints; it is
 * normalized and validated against ProfileSchema when merged.
 */
export const ParsedResumeSchema = z.object({
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable().describe("Phone number as written, including country code if present"),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  linkedin: z.string().nullable(),
  github: z.string().nullable(),
  website: z.string().nullable(),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      startDate: z.string().nullable().describe("YYYY-MM"),
      endDate: z.string().nullable().describe("YYYY-MM, or null if current"),
      current: z.boolean(),
      bullets: z.array(z.string()).describe("Each bullet verbatim from the resume"),
    }),
  ),
  education: z.array(
    z.object({
      school: z.string(),
      degreeLevel: DegreeLevel.nullable(),
      degree: z.string().nullable().describe("Degree name as written, e.g. 'B.S. Computer Science'"),
      major: z.string().nullable(),
      minor: z.string().nullable(),
      gpa: z.number().nullable(),
      gpaScale: z.number().nullable(),
      startDate: z.string().nullable().describe("YYYY-MM"),
      graduationDate: z.string().nullable().describe("YYYY-MM"),
      graduationExpected: z.boolean().describe("True if the graduation date is in the future"),
      honors: z.array(z.string()),
    }),
  ),
  skills: z.array(z.string()),
  certifications: z.array(z.object({ name: z.string(), issuer: z.string().nullable(), date: z.string().nullable() })),
  languages: z.array(z.object({ language: z.string(), proficiency: LanguageProficiency.nullable() })),
  projects: z.array(z.object({ name: z.string(), description: z.string().nullable(), url: z.string().nullable() })),
  publications: z.array(z.object({ title: z.string(), venue: z.string().nullable(), date: z.string().nullable() })),
});

export type ParsedResume = z.infer<typeof ParsedResumeSchema>;

const SYSTEM = `You extract structured data from a job seeker's resume.

Copy facts exactly as they appear. Do not infer, embellish, or fill gaps: if the resume doesn't state something, use null (or an empty list). Never guess a GPA, a date, a degree level, or a location that isn't written.

Dates: convert to YYYY-MM. If only a year is written, use YYYY-01 and keep it. "Present" or "Current" means current=true and endDate=null.
Bullets: one entry per bullet or sentence describing the role, verbatim.
Skills: individual skills, tools, and languages listed anywhere on the resume, deduplicated.
Links: full URLs. Add https:// if the resume omits the scheme.`;

/** Parses a resume with Claude. PDFs are sent as documents; DOCX as extracted text. */
export async function parseResume(
  llm: Llm,
  doc: { sha256: string; mimeType: string; bytes?: Uint8Array; text: string },
): Promise<ParsedResume> {
  const content =
    doc.mimeType === "application/pdf" && doc.bytes
      ? [
          {
            type: "document" as const,
            source: { type: "base64" as const, media_type: "application/pdf" as const, data: Buffer.from(doc.bytes).toString("base64") },
          },
          { type: "text" as const, text: "Extract this resume." },
        ]
      : `Extract this resume.\n\n<resume>\n${doc.text}\n</resume>`;
  return llm.structured({
    task: "parse_resume",
    system: SYSTEM,
    content,
    schema: ParsedResumeSchema,
    replayKey: { documentSha256: doc.sha256 },
  });
}

// ------------------------------------------------------------------ heuristics

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const LINKEDIN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i;

/**
 * Fallback when no API key is configured: pulls only what can be found
 * reliably with patterns (contact details and links). Everything else is left
 * for the user to enter.
 */
export function heuristicParse(text: string): ParsedResume {
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const nameParts = /^[A-Za-z][A-Za-z'’.-]+(\s+[A-Za-z][A-Za-z'’.-]+){1,3}$/.test(firstLine) ? firstLine.split(/\s+/) : [];
  const withScheme = (u?: string) => (u ? (u.startsWith("http") ? u : `https://${u}`).replace(/\/$/, "") : null);
  return {
    firstName: nameParts[0] ?? null,
    middleName: nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : null,
    lastName: nameParts.length > 1 ? nameParts[nameParts.length - 1]! : null,
    email: text.match(EMAIL)?.[0] ?? null,
    phone: text.match(PHONE)?.[0] ?? null,
    city: null,
    state: null,
    country: null,
    linkedin: withScheme(text.match(LINKEDIN)?.[0]),
    github: withScheme(text.match(GITHUB)?.[0]),
    website: null,
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    languages: [],
    projects: [],
    publications: [],
  };
}

// ------------------------------------------------------------------ merging

/** Splits "+1 (555) 010-2030" into { countryCode: "+1", number: "(555) 010-2030" }. */
export function splitPhone(raw: string): { countryCode: string | null; number: string } {
  const m = raw.trim().match(/^\+(\d{1,3})[\s.-]*(.*)$/);
  if (m) return { countryCode: `+${m[1]}`, number: m[2]!.trim() };
  return { countryCode: null, number: raw.trim() };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const month = (s: string | null | undefined) => (s && MONTH.test(s) ? s : null);
const url = (s: string | null | undefined) => {
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    return new URL(withScheme).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

/** Sets a field from the parse unless the user already confirmed a value. */
function suggest<T>(f: Field<T>, value: T | null | undefined): Field<T> {
  if (f.confirmedByUser && f.value !== null) return f;
  if (value === null || value === undefined || value === "") return f;
  return { value, confirmedByUser: false };
}

const key = (...parts: (string | null | undefined)[]) => parts.map((p) => (p ?? "").trim().toLowerCase()).join("|");

/**
 * Merges parsed resume data into the profile as unconfirmed suggestions.
 * Confirmed values are never overwritten; list entries already present
 * (same company+title, same school+degree, ...) are not duplicated.
 */
export function mergeParsedIntoProfile(profile: Profile, parsed: ParsedResume): Profile {
  const p = structuredClone(profile);
  const id = p.identity;
  id.legalFirstName = suggest(id.legalFirstName, parsed.firstName);
  id.legalMiddleName = suggest(id.legalMiddleName, parsed.middleName);
  id.legalLastName = suggest(id.legalLastName, parsed.lastName);
  id.email = suggest(id.email, parsed.email && EMAIL.test(parsed.email) ? parsed.email : null);
  if (parsed.phone) {
    const { countryCode, number } = splitPhone(parsed.phone);
    id.phoneNumber = suggest(id.phoneNumber, number);
    id.phoneCountryCode = suggest(id.phoneCountryCode, countryCode);
  }
  id.city = suggest(id.city, parsed.city);
  id.state = suggest(id.state, parsed.state);
  id.country = suggest(id.country, parsed.country);
  p.links.linkedin = suggest(p.links.linkedin, url(parsed.linkedin));
  p.links.github = suggest(p.links.github, url(parsed.github));
  p.links.website = suggest(p.links.website, url(parsed.website));

  const haveJobs = new Set(p.experience.map((e) => key(e.company, e.title)));
  for (const e of parsed.experience) {
    if (haveJobs.has(key(e.company, e.title))) continue;
    p.experience.push({
      id: randomUUID(),
      company: e.company,
      title: e.title,
      location: e.location ?? "",
      startDate: month(e.startDate),
      endDate: e.current ? null : month(e.endDate),
      current: e.current,
      bullets: e.bullets,
      confirmedByUser: false,
    });
  }

  const haveSchools = new Set(p.education.map((s) => key(s.school, s.degree)));
  for (const s of parsed.education) {
    if (haveSchools.has(key(s.school, s.degree))) continue;
    p.education.push({
      id: randomUUID(),
      school: s.school,
      degreeLevel: s.degreeLevel,
      degree: s.degree ?? "",
      major: s.major ?? "",
      minor: s.minor ?? "",
      gpa: s.gpa !== null && s.gpa >= 0 && s.gpa <= 10 ? s.gpa : null,
      gpaScale: s.gpaScale && s.gpaScale > 0 ? s.gpaScale : 4,
      startDate: month(s.startDate),
      graduationDate: month(s.graduationDate),
      graduationExpected: s.graduationExpected,
      honors: s.honors,
      confirmedByUser: false,
    });
  }

  if (!p.skills.confirmedByUser || !p.skills.value?.length) {
    const merged = [...new Set([...(p.skills.value ?? []), ...parsed.skills.map((s) => s.trim()).filter(Boolean)])];
    p.skills = { value: merged, confirmedByUser: false };
  }

  const haveCerts = new Set(p.certifications.map((c) => key(c.name)));
  for (const c of parsed.certifications) {
    if (haveCerts.has(key(c.name))) continue;
    p.certifications.push({ id: randomUUID(), name: c.name, issuer: c.issuer ?? "", date: month(c.date), confirmedByUser: false });
  }
  const haveLangs = new Set(p.languages.map((l) => key(l.language)));
  for (const l of parsed.languages) {
    if (haveLangs.has(key(l.language))) continue;
    p.languages.push({
      id: randomUUID(),
      language: l.language,
      proficiency: l.proficiency ?? "professional_working",
      confirmedByUser: false,
    });
  }
  const haveProjects = new Set(p.projects.map((x) => key(x.name)));
  for (const x of parsed.projects) {
    if (haveProjects.has(key(x.name))) continue;
    p.projects.push({ id: randomUUID(), name: x.name, description: x.description ?? "", url: url(x.url), skills: [], confirmedByUser: false });
  }
  const havePubs = new Set(p.publications.map((x) => key(x.title)));
  for (const x of parsed.publications) {
    if (havePubs.has(key(x.title))) continue;
    p.publications.push({ id: randomUUID(), title: x.title, venue: x.venue ?? "", date: month(x.date), url: null, confirmedByUser: false });
  }
  return p;
}

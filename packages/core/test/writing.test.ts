import { describe, expect, it } from "vitest";
import { FakeLlm } from "../src/llm/index.ts";
import { ProfileSchema, type Profile } from "../src/profile/schema.ts";
import {
  buildFactSheet,
  checkClaims,
  draftVerified,
  scanText,
  verifyText,
  writeAnswer,
  writeCoverLetter,
  type Claim,
} from "../src/writing/index.ts";

const c = <T>(value: T) => ({ value, confirmedByUser: true });

function profile(): Profile {
  return ProfileSchema.parse({
    identity: {
      legalFirstName: c("Jordan"),
      legalLastName: c("Rivera"),
      email: c("jordan.rivera@example.com"),
      phoneNumber: c("555-010-2030"),
    },
    links: { github: c("https://github.com/jrivera") },
    experience: [
      {
        id: "e1",
        company: "Northwind Labs",
        title: "Software Engineering Intern",
        startDate: "2025-05",
        endDate: "2025-08",
        bullets: [
          "Built a TypeScript service that cut report generation time from 40s to 6s.",
          "Added integration tests for the billing API, raising coverage from 52% to 81%.",
        ],
        confirmedByUser: true,
      },
      {
        id: "e2",
        company: "UT Austin Dept of CS",
        title: "Teaching Assistant",
        startDate: "2024-01",
        endDate: "2024-12",
        bullets: ["Held weekly office hours for 30 students."],
        confirmedByUser: true,
      },
      {
        id: "e3",
        company: "Globex Corporation",
        title: "Staff Engineer",
        startDate: "2020-01",
        endDate: "2023-01",
        bullets: ["Cut cloud costs by 77%."],
        confirmedByUser: false,
      },
    ],
    education: [
      {
        id: "d1",
        school: "UT Austin",
        degreeLevel: "bachelor",
        degree: "B.S. Computer Science",
        major: "Computer Science",
        gpa: 3.7,
        gpaScale: 4,
        startDate: "2022-08",
        graduationDate: "2026-05",
        graduationExpected: true,
        confirmedByUser: true,
      },
    ],
    skills: c(["TypeScript", "Python", "React", "Node.js", "PostgreSQL", "Docker", "Git"]),
    projects: [{ id: "p1", name: "Trailhead", description: "A hiking trip planner.", skills: ["React"], confirmedByUser: true }],
    workAuthorization: { visaType: c("H-1B"), citizenship: c(["IN"]), requiresSponsorshipNow: c(true) },
    eeo: { gender: c("female"), veteranStatus: c("protected_veteran"), disabilityStatus: c("yes") },
    voice: { tone: c("warm and concise") },
  });
}

const JOB = { company: "Acme Robotics", title: "Software Engineer Intern", description: "Build internal tools in TypeScript." };

const FAITHFUL = `Dear Hiring Manager,

I am applying for the Software Engineer Intern role at Acme Robotics. At Northwind Labs I built a TypeScript service that cut report generation time from 40s to 6s, and I raised billing API test coverage from 52% to 81%. I work with TypeScript, Python, React and PostgreSQL, and I built Trailhead as a side project.

Sincerely,
Jordan Rivera`;

const FABRICATED = `Dear Hiring Manager,

At Google I led a team of 12 and improved latency by 95%. I also hold my Kubernetes certification and have used TypeScript daily.

Sincerely,
Jordan Rivera`;

const FAITHFUL_CLAIMS: Claim[] = [
  { text: "At Northwind Labs I built a TypeScript service", type: "employer", value: "Northwind Labs" },
  { text: "cut report generation time from 40s to 6s", type: "metric", value: "40s to 6s" },
  { text: "raised billing API test coverage from 52% to 81%", type: "metric", value: "52% to 81%" },
  { text: "I work with TypeScript, Python, React and PostgreSQL", type: "skill", value: "TypeScript, Python, React, PostgreSQL" },
  { text: "I built Trailhead", type: "project", value: "Trailhead" },
];

const FABRICATED_CLAIMS: Claim[] = [
  { text: "At Google I led a team of 12", type: "employer", value: "Google" },
  { text: "led a team of 12", type: "metric", value: "12" },
  { text: "improved latency by 95%", type: "metric", value: "95%" },
  { text: "my Kubernetes certification", type: "certification", value: "Kubernetes" },
  { text: "have used TypeScript daily", type: "skill", value: "TypeScript" },
];

function extractor(map: Record<string, Claim[]>) {
  return (input: unknown) => {
    const { text } = input as { text: string };
    return { claims: map[text] ?? [] };
  };
}

describe("buildFactSheet", () => {
  const { text, known } = buildFactSheet(profile());

  it("contains confirmed facts", () => {
    for (const s of [
      "Jordan Rivera",
      "Software Engineering Intern at Northwind Labs",
      "cut report generation time from 40s to 6s",
      "raising coverage from 52% to 81%",
      "Teaching Assistant at UT Austin Dept of CS",
      "B.S. Computer Science",
      "GPA 3.7/4",
      "TypeScript, Python, React, Node.js, PostgreSQL, Docker, Git",
      "Trailhead",
      "github.com/jrivera",
    ])
      expect(text).toContain(s);
    expect(known.employers.has("northwind labs")).toBe(true);
    expect(known.skills.has("node")).toBe(true);
    for (const n of ["40", "6", "52", "81", "30", "3.7", "2025"]) expect(known.numbers.has(n)).toBe(true);
    expect(known.experienceMonths).toBe(4 + 12);
  });

  it("excludes unconfirmed entries, contact details, EEO and work authorization", () => {
    for (const s of ["Globex", "Staff Engineer", "77%", "H-1B", "female", "veteran", "disab", "sponsor", "citizen", "555-010", "example.com"])
      expect(text.toLowerCase()).not.toContain(s.toLowerCase());
    expect(known.numbers.has("77")).toBe(false);
  });

  it("is deterministic", () => {
    expect(buildFactSheet(profile()).text).toBe(text);
  });
});

describe("claim verification", () => {
  const { known } = buildFactSheet(profile());

  it("flags a fabricated letter via extracted claims", () => {
    const { supported, unsupported } = checkClaims(FABRICATED_CLAIMS, known);
    expect(unsupported.map((u) => u.claim.value)).toEqual(["Google", "12", "95%", "Kubernetes"]);
    expect(supported.map((s) => s.value)).toEqual(["TypeScript"]);
  });

  it("flags a fabricated letter via the deterministic scan alone", () => {
    const values = scanText(FABRICATED, known, { allowedEntities: [JOB.company] }).map((u) => u.claim.value);
    expect(values).toEqual(expect.arrayContaining(["Google", "12", "95"]));
    expect(values).not.toContain("TypeScript");
  });

  it("scan catches inflated durations and spelled-out numbers", () => {
    const hits = scanText("I have five years of experience and shipped twelve services.", known);
    expect(hits.map((h) => h.claim.type).sort()).toEqual(["duration", "metric"]);
    expect(scanText("In my four years at the university I studied hard.", known)).toEqual([]);
  });

  it("accepts a faithful letter from both checks", async () => {
    expect(checkClaims(FAITHFUL_CLAIMS, known).unsupported).toEqual([]);
    expect(scanText(FAITHFUL, known, { allowedEntities: [JOB.company, JOB.title] })).toEqual([]);
    const llm = new FakeLlm({ extract_claims: extractor({ [FAITHFUL]: FAITHFUL_CLAIMS }) });
    const r = await verifyText(llm, FAITHFUL, known, { allowedEntities: [JOB.company, JOB.title] });
    expect(r.unsupported).toEqual([]);
    expect(r.supported).toHaveLength(FAITHFUL_CLAIMS.length);
  });

  it("verifyText combines extractor and scan, even when the extractor misses everything", async () => {
    const llm = new FakeLlm({ extract_claims: () => ({ claims: [] }) });
    const r = await verifyText(llm, FABRICATED, known, { allowedEntities: [JOB.company] });
    expect(r.unsupported.map((u) => u.claim.value)).toEqual(expect.arrayContaining(["Google", "12", "95"]));
  });

  it("matches entity and skill variants but stays strict", () => {
    const claims: Claim[] = [
      { text: "x", type: "employer", value: "Northwind Labs, Inc." },
      { text: "x", type: "employer", value: "UT Austin" },
      { text: "x", type: "school", value: "UT Austin" },
      { text: "x", type: "skill", value: "NodeJS" },
      { text: "x", type: "skill", value: "Postgres" },
      { text: "x", type: "degree", value: "Bachelor of Science in Computer Science" },
      { text: "x", type: "title", value: "Software Engineer Intern" },
      { text: "x", type: "duration", value: "4 months" },
    ];
    expect(checkClaims(claims, known).unsupported).toEqual([]);
    const bad: Claim[] = [
      { text: "x", type: "employer", value: "Northwind Systems Group" },
      { text: "x", type: "skill", value: "Rust" },
      { text: "x", type: "degree", value: "M.S. Computer Science" },
      { text: "x", type: "title", value: "Senior Software Engineer" },
      { text: "x", type: "duration", value: "two years of experience" },
      { text: "x", type: "other_fact", value: "managed a $2M budget" },
      { text: "I built a TypeScript service that cut report generation time", type: "other_fact", value: "" },
    ];
    const r = checkClaims(bad, known);
    expect(r.unsupported.map((u) => u.claim.type)).toEqual(["employer", "skill", "degree", "title", "duration", "other_fact"]);
    expect(r.supported.map((s) => s.type)).toEqual(["other_fact"]);
  });
});

describe("generation", () => {
  it("never sends EEO, work authorization or unconfirmed data to the model", async () => {
    const seen: string[] = [];
    const llm = new FakeLlm({
      write_cover_letter: (_k, req) => {
        seen.push(req.system, JSON.stringify(req.content));
        return { letter: FAITHFUL };
      },
      write_answer: (_k, req) => {
        seen.push(req.system, JSON.stringify(req.content));
        return { answer: "I like building tools.", insufficientFacts: false };
      },
    });
    expect(await writeCoverLetter(llm, { profile: profile(), job: JOB })).toBe(FAITHFUL);
    await writeAnswer(llm, { profile: profile(), question: "Why us?", job: JOB });
    const all = seen.join("\n").toLowerCase();
    for (const s of ["h-1b", "female", "veteran", "disab", "sponsor", "citizenship", "globex", "77%", "555-010", "example.com"])
      expect(all).not.toContain(s);
    expect(all).toContain("never state experience");
    expect(all).toContain("200 to 350 words");
    expect(all).toContain("warm and concise");
    expect(all).toContain("40s to 6s");
  });

  it("builds stable replay keys without timestamps", async () => {
    const llm = new FakeLlm({ write_cover_letter: () => ({ letter: "x" }) });
    await writeCoverLetter(llm, { profile: profile(), job: JOB });
    await writeCoverLetter(llm, { profile: profile(), job: JOB });
    expect(llm.calls[0]!.replayKey).toEqual(llm.calls[1]!.replayKey);
    expect(Object.keys(llm.calls[0]!.replayKey as object).sort()).toEqual(["company", "description", "examples", "facts", "title", "tone"]);
  });

  it("clips answers to maxLength without adding words", async () => {
    const llm = new FakeLlm({ write_answer: () => ({ answer: "First sentence here. Second sentence goes on and on.", insufficientFacts: false }) });
    const r = await writeAnswer(llm, { profile: profile(), question: "Why?", job: JOB, maxLength: 30 });
    expect(r.answer).toBe("First sentence here.");
  });
});

describe("draftVerified", () => {
  const extract = extractor({
    [FABRICATED]: FABRICATED_CLAIMS,
    [FAITHFUL]: FAITHFUL_CLAIMS,
  });

  it("regenerates once with the rejected claims banned, then succeeds", async () => {
    const llm = new FakeLlm({
      write_cover_letter: (key) => ({ letter: (key as { avoid?: string[] }).avoid ? FAITHFUL : FABRICATED }),
      extract_claims: extract,
    });
    const r = await draftVerified(llm, { kind: "cover_letter", profile: profile(), job: JOB });
    expect(r).toEqual({ status: "ok", text: FAITHFUL, attempts: 2 });
    const writes = llm.calls.filter((x) => x.task === "write_cover_letter");
    expect(writes).toHaveLength(2);
    expect(writes[0]!.replayKey).not.toHaveProperty("avoid");
    const avoid = (writes[1]!.replayKey as { avoid: string[] }).avoid.join("\n");
    expect(avoid).toContain("At Google I led a team of 12");
    expect(avoid).toContain("improved latency by 95%");
    expect(avoid).toContain("Kubernetes certification");
  });

  it("puts the banned claims in the retry prompt too", async () => {
    const prompts: string[] = [];
    const llm = new FakeLlm({
      write_cover_letter: (key, req) => {
        prompts.push(JSON.stringify(req.content));
        return { letter: (key as { avoid?: string[] }).avoid ? FAITHFUL : FABRICATED };
      },
      extract_claims: extract,
    });
    await draftVerified(llm, { kind: "cover_letter", profile: profile(), job: JOB });
    expect(prompts[0]).not.toContain("DO NOT SAY");
    expect(prompts[1]).toContain("DO NOT SAY THESE");
    expect(prompts[1]).toContain("improved latency by 95%");
  });

  it("returns needs_input when both drafts are fabricated", async () => {
    const llm = new FakeLlm({ write_cover_letter: () => ({ letter: FABRICATED }), extract_claims: extract });
    const r = await draftVerified(llm, { kind: "cover_letter", profile: profile(), job: JOB });
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect(r.lastDraft).toBe(FABRICATED);
    expect(r.unsupported.map((u) => u.claim.value)).toEqual(expect.arrayContaining(["Google", "12", "95%", "Kubernetes"]));
    expect(llm.calls.filter((x) => x.task === "write_cover_letter")).toHaveLength(2);
  });

  it("passes a faithful first draft with one attempt", async () => {
    const llm = new FakeLlm({ write_cover_letter: () => ({ letter: FAITHFUL }), extract_claims: extract });
    expect(await draftVerified(llm, { kind: "cover_letter", profile: profile(), job: JOB })).toEqual({ status: "ok", text: FAITHFUL, attempts: 1 });
  });

  it("sends insufficientFacts straight to needs_input", async () => {
    const llm = new FakeLlm({ write_answer: () => ({ answer: "", insufficientFacts: true }) });
    const r = await draftVerified(llm, { kind: "answer", profile: profile(), question: "Describe your experience with Rust.", job: JOB });
    expect(r.status).toBe("needs_input");
    expect(llm.calls).toHaveLength(1);
  });

  it("verifies answers too", async () => {
    const bad = "At Initech I shipped a Kubernetes platform used by 400 teams.";
    const good = "I enjoy building tools, like the TypeScript service I built at Northwind Labs.";
    const llm = new FakeLlm({
      write_answer: (key) => ({ answer: (key as { avoid?: string[] }).avoid ? good : bad, insufficientFacts: false }),
      extract_claims: extractor({
        [bad]: [{ text: "At Initech I shipped a Kubernetes platform", type: "employer", value: "Initech" }],
        [good]: [{ text: "TypeScript service I built at Northwind Labs", type: "employer", value: "Northwind Labs" }],
      }),
    });
    const r = await draftVerified(llm, { kind: "answer", profile: profile(), question: "Why us?", job: JOB });
    expect(r).toEqual({ status: "ok", text: good, attempts: 2 });
  });
});

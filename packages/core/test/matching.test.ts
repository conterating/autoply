import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../src/applications/status.ts";
import { transition } from "../src/applications/transition.ts";
import { openMemoryDb } from "../src/db/index.ts";
import { applicationEvents, applications, postings } from "../src/db/schema.ts";
import { FakeLlm } from "../src/llm/replay.ts";
import { dedupeKey } from "../src/matching/dedupe.ts";
import { hardFilter, inferSeniority, type FilterablePosting } from "../src/matching/filters.ts";
import { ingestPostings, matchNewPostings, type IngestPosting } from "../src/matching/pipeline.ts";
import { profileSummary, scoreRelevance } from "../src/matching/score.ts";
import { emptyProfile, ProfileSchema, type Profile } from "../src/profile/schema.ts";
import { defaultSettings } from "../src/settings.ts";

const c = <T>(value: T) => ({ value, confirmedByUser: true });
const u = <T>(value: T) => ({ value, confirmedByUser: false });

function profileWith(prefs: Record<string, unknown>, extra: Record<string, unknown> = {}): Profile {
  return ProfileSchema.parse({ preferences: prefs, ...extra });
}

const posting = (over: Partial<FilterablePosting> = {}): FilterablePosting => ({
  company: "Acme",
  title: "Software Engineer",
  location: "San Francisco, CA",
  workplaceType: "onsite",
  description: "Build things.",
  ...over,
});

describe("hardFilter", () => {
  it("passes everything for an empty profile", () => {
    expect(hardFilter(posting(), emptyProfile())).toEqual({ pass: true, reasons: [] });
  });

  it("ignores unconfirmed preferences", () => {
    const p = profileWith({
      excludedCompanies: u(["Acme"]),
      excludedKeywords: u(["things"]),
      seniority: u(["senior"]),
      workplaceTypes: u(["remote"]),
      locations: u(["Berlin"]),
      employmentTypes: u(["contract"]),
      minimumSalary: u(500000),
    });
    expect(hardFilter(posting({ title: "Junior Intern", description: "$10,000 - $20,000" }), p).pass).toBe(true);
  });

  it("excludes companies case-insensitively", () => {
    const r = hardFilter(posting({ company: "ACME" }), profileWith({ excludedCompanies: c(["acme"]) }));
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/excluded list/);
  });

  it("excludes keywords in title or description, on word boundaries", () => {
    const p = profileWith({ excludedKeywords: c(["php", "Security Clearance"]) });
    expect(hardFilter(posting({ description: "We use PHP daily" }), p).pass).toBe(false);
    expect(hardFilter(posting({ title: "PHP Developer" }), p).pass).toBe(false);
    expect(hardFilter(posting({ description: "Requires security clearance" }), p).pass).toBe(false);
    expect(hardFilter(posting({ description: "phpstorm fans" }), p).pass).toBe(true);
  });

  it("infers seniority from titles", () => {
    expect(inferSeniority("Senior Software Engineer")).toEqual(["senior"]);
    expect(inferSeniority("Sr. Engineer")).toEqual(["senior"]);
    expect(inferSeniority("Software Engineering Intern")).toEqual(["intern"]);
    expect(inferSeniority("New Grad Software Engineer")).toEqual(["entry"]);
    expect(inferSeniority("Staff Engineer")).toEqual(["staff"]);
    expect(inferSeniority("Principal Engineer")).toEqual(["principal"]);
    expect(inferSeniority("Director of Engineering")).toEqual(["director"]);
    expect(inferSeniority("Engineering Manager")).toEqual(["manager"]);
    expect(inferSeniority("Product Manager")).toEqual([]);
    expect(inferSeniority("Internal Tools Engineer")).toEqual([]);
    expect(inferSeniority("Software Engineer")).toEqual([]);
  });

  it("filters by seniority; unknown seniority passes", () => {
    const p = profileWith({ seniority: c(["entry", "intern"]) });
    expect(hardFilter(posting({ title: "Senior Software Engineer" }), p).pass).toBe(false);
    expect(hardFilter(posting({ title: "Staff Engineer" }), p).pass).toBe(false);
    expect(hardFilter(posting({ title: "Junior Developer" }), p).pass).toBe(true);
    expect(hardFilter(posting({ title: "Software Engineer" }), p).pass).toBe(true);
    expect(hardFilter(posting({ title: "Tech Lead" }), profileWith({ seniority: c(["staff"]) })).pass).toBe(true);
  });

  it("filters by workplace type", () => {
    const p = profileWith({ workplaceTypes: c(["remote", "hybrid"]) });
    expect(hardFilter(posting({ workplaceType: "onsite" }), p).pass).toBe(false);
    expect(hardFilter(posting({ workplaceType: "remote" }), p).pass).toBe(true);
    expect(hardFilter(posting({ workplaceType: "unknown" }), p).pass).toBe(true);
  });

  it("matches locations by city/state/country token, with remote and relocation exceptions", () => {
    const p = profileWith({ locations: c(["San Francisco, CA", "New York, NY"]) });
    expect(hardFilter(posting({ location: "San Francisco, CA" }), p).pass).toBe(true);
    expect(hardFilter(posting({ location: "New York City, New York" }), p).pass).toBe(true);
    expect(hardFilter(posting({ location: "Berlin, Germany" }), p).pass).toBe(false);
    expect(hardFilter(posting({ location: "" }), p).pass).toBe(true);
    const accepts = profileWith({ locations: c(["Austin, TX"]), workplaceTypes: c(["remote", "onsite"]) });
    expect(hardFilter(posting({ location: "Remote - Canada", workplaceType: "remote" }), accepts).pass).toBe(true);
    const reloc = profileWith({ locations: c(["Austin, TX"]), willingToRelocate: c(true) });
    expect(hardFilter(posting({ location: "Berlin" }), reloc).pass).toBe(true);
    const state = profileWith({ locations: c(["California"]) });
    expect(hardFilter(posting({ location: "Oakland, CA" }), state).pass).toBe(true);
  });

  it("fails when confirmed not authorized in the posting's country", () => {
    const p = ProfileSchema.parse({ workAuthorization: { authorizedCountries: c([{ country: "US", authorized: true }, { country: "Canada", authorized: false }]) } });
    expect(hardFilter(posting({ location: "Toronto, Canada" }), p).pass).toBe(false);
    expect(hardFilter(posting({ location: "Austin, United States" }), p).pass).toBe(true);
    expect(hardFilter(posting({ location: "Paris, France" }), p).pass).toBe(true);
    const unconfirmed = ProfileSchema.parse({ workAuthorization: { authorizedCountries: u([{ country: "Canada", authorized: false }]) } });
    expect(hardFilter(posting({ location: "Toronto, Canada" }), unconfirmed).pass).toBe(true);
  });

  it("fails on no-sponsorship language only when sponsorship is needed", () => {
    const needs = ProfileSchema.parse({ workAuthorization: { requiresSponsorshipNow: c(true) } });
    const doesNot = ProfileSchema.parse({ workAuthorization: { requiresSponsorshipNow: c(false) } });
    for (const d of [
      "We are unable to sponsor visas.",
      "No sponsorship available.",
      "Must be authorized to work in the US without sponsorship.",
      "We do not provide visa sponsorship.",
      "Company will not sponsor work visas",
    ]) {
      expect(hardFilter(posting({ description: d }), needs).pass, d).toBe(false);
      expect(hardFilter(posting({ description: d }), doesNot).pass, d).toBe(true);
    }
    expect(hardFilter(posting({ description: "We sponsor visas for great candidates." }), needs).pass).toBe(true);
    expect(hardFilter(posting({ description: "Build things." }), ProfileSchema.parse({ workAuthorization: { requiresSponsorshipNow: u(true) } })).pass).toBe(true);
  });

  it("filters employment types", () => {
    const p = profileWith({ employmentTypes: c(["full_time"]) });
    expect(hardFilter(posting({ title: "Software Engineer Intern" }), p).pass).toBe(false);
    expect(hardFilter(posting({ title: "Contract Developer" }), p).pass).toBe(false);
    expect(hardFilter(posting({ title: "Software Engineer" }), p).pass).toBe(true);
    expect(hardFilter(posting({ title: "Intern" }), profileWith({ employmentTypes: c(["internship"]) })).pass).toBe(true);
  });

  it("filters on minimum salary only when a range is parseable", () => {
    const p = profileWith({ minimumSalary: c(150000) });
    expect(hardFilter(posting({ description: "Pay: $100,000 - $140,000 per year" }), p).pass).toBe(false);
    expect(hardFilter(posting({ description: "Pay: $100k–$140k" }), p).pass).toBe(false);
    expect(hardFilter(posting({ description: "Pay: $120,000 to $180,000" }), p).pass).toBe(true);
    expect(hardFilter(posting({ description: "$25 - $40 per hour" }), p).pass).toBe(true);
    expect(hardFilter(posting({ description: "Competitive pay" }), p).pass).toBe(true);
    expect(hardFilter(posting({ raw: { salaryRange: { currency: "USD", interval: "per-year-salary", min: 90000, max: 120000 } } }), p).pass).toBe(false);
    expect(hardFilter(posting({ description: "$100,000 - $140,000; NYC: $150,000 - $200,000" }), p).pass).toBe(true);
  });

  it("reports every failing reason", () => {
    const p = profileWith({ excludedCompanies: c(["Acme"]), seniority: c(["entry"]) });
    expect(hardFilter(posting({ title: "Senior Engineer" }), p).reasons).toHaveLength(2);
  });
});

describe("scoreRelevance and profileSummary", () => {
  const profile = ProfileSchema.parse({
    preferences: { targetTitles: c(["Backend Engineer"]), seniority: c(["entry"]) },
    skills: c(["TypeScript", "SQL"]),
    education: [
      { id: "e1", school: "State U", degreeLevel: "bachelor", degree: "BS", major: "CS", graduationDate: "2024-05", confirmedByUser: true },
      { id: "e2", school: "Secret U", confirmedByUser: false },
    ],
    experience: [
      { id: "x1", company: "Initech", title: "Engineer", startDate: "2024-06", current: true, confirmedByUser: true },
      { id: "x2", company: "Unconfirmed Inc", title: "Wizard", confirmedByUser: false },
    ],
    eeo: { gender: c("female") },
    workAuthorization: { visaType: c("H1B") },
  });

  it("summarizes confirmed data only and no EEO/legal data", () => {
    const s = profileSummary(profile);
    expect(s).toContain("Target titles: Backend Engineer");
    expect(s).toContain("Skills: TypeScript, SQL");
    expect(s).toContain("State U");
    expect(s).toContain("Engineer at Initech");
    expect(s).not.toContain("Unconfirmed");
    expect(s).not.toContain("Secret U");
    expect(s).not.toMatch(/female|H1B|gender/i);
    expect(profileSummary(profile)).toBe(s);
    expect(profileSummary(emptyProfile())).toBe("");
  });

  const p = { externalId: "1", ats: "greenhouse", title: "Backend Engineer", company: "Acme", location: "NYC", description: "TypeScript and SQL" };

  it("calls the LLM with a stable replay key and clamps output", async () => {
    const llm = new FakeLlm({ score_relevance: () => ({ score: 140.4, reason: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix" }) });
    const r = await scoreRelevance(llm, { posting: p, profileSummary: "S" });
    expect(r.score).toBe(100);
    expect(r.reason.split(" ")).toHaveLength(25);
    await scoreRelevance(llm, { posting: p, profileSummary: "S" });
    expect(llm.calls[0]!.replayKey).toEqual(llm.calls[1]!.replayKey);
    expect(llm.calls[0]!.replayKey).toMatchObject({ externalId: "1", ats: "greenhouse", title: "Backend Engineer", company: "Acme", profileSummary: "S" });
    await scoreRelevance(llm, { posting: { ...p, description: "other" }, profileSummary: "S" });
    expect(llm.calls[2]!.replayKey).not.toEqual(llm.calls[0]!.replayKey);
  });

  it("rejects out-of-schema responses", async () => {
    const llm = new FakeLlm({ score_relevance: () => ({ nope: 1 }) });
    await expect(scoreRelevance(llm, { posting: p, profileSummary: "S" })).rejects.toThrow();
  });
});

const ing = (n: number, over: Partial<IngestPosting> = {}): IngestPosting => ({
  ats: "greenhouse",
  externalId: String(n),
  company: "Acme",
  title: `Engineer ${n}`,
  location: "NYC",
  workplaceType: "onsite",
  url: `https://x/${n}`,
  applyUrl: `https://x/${n}/apply`,
  description: "Build things",
  postedAt: null,
  ...over,
});

describe("ingestPostings", () => {
  it("dedupes on (ats, external_id) and on dedupe key; re-ingest is idempotent", () => {
    const db = openMemoryDb();
    const first = ingestPostings(db, null, [ing(1), ing(2)]);
    expect(first).toHaveLength(2);
    // same ats+id, different text
    expect(ingestPostings(db, null, [ing(1, { title: "Renamed" })])).toHaveLength(0);
    // different id, same company/title/location after normalization
    expect(ingestPostings(db, null, [ing(3, { title: "engineer 1", location: "NYC." })])).toHaveLength(0);
    expect(ingestPostings(db, null, [ing(3, { title: "engineer 2" , location: "nyc"})])).toHaveLength(0);
    // same id on another ATS is distinct
    expect(ingestPostings(db, null, [ing(1, { ats: "lever", title: "Other" })])).toHaveLength(1);
    // duplicates inside one batch
    expect(ingestPostings(db, null, [ing(9), ing(9)])).toHaveLength(1);
    expect(ingestPostings(db, null, [ing(1), ing(2), ing(9)])).toHaveLength(0);
    expect(db.select().from(postings).all()).toHaveLength(4);
  });

  it("stores the dedupe key and skips unknown ATS kinds", () => {
    const db = openMemoryDb();
    const [row] = ingestPostings(db, null, [ing(1, { company: "Acme, Inc.", location: "Remote (US)" }), ing(2, { ats: "mystery" })]);
    expect(row!.dedupeKey).toBe(dedupeKey("Acme, Inc.", "Engineer 1", "Remote - US"));
    expect(db.select().from(postings).all()).toHaveLength(1);
  });
});

describe("transition", () => {
  function setup() {
    const db = openMemoryDb();
    const [p] = ingestPostings(db, null, [ing(1)]);
    const app = db.insert(applications).values({ postingId: p!.id }).returning().get();
    return { db, app };
  }

  it("updates status, patches fields and records an event atomically", () => {
    const { db, app } = setup();
    transition(db, app.id, "matched", "good fit", { matchScore: 88, matchReason: "nice" });
    const row = db.select().from(applications).where(eq(applications.id, app.id)).get()!;
    expect(row).toMatchObject({ status: "matched", matchScore: 88, matchReason: "nice" });
    const events = db.select().from(applicationEvents).all();
    expect(events).toEqual([expect.objectContaining({ applicationId: app.id, fromStatus: "discovered", toStatus: "matched", detail: "good fit" })]);
  });

  it("rejects invalid transitions and writes nothing", () => {
    const { db, app } = setup();
    expect(() => transition(db, app.id, "submitted", "x", { matchScore: 1 })).toThrow(InvalidTransitionError);
    const row = db.select().from(applications).where(eq(applications.id, app.id)).get()!;
    expect(row.status).toBe("discovered");
    expect(row.matchScore).toBeNull();
    expect(db.select().from(applicationEvents).all()).toHaveLength(0);
  });

  it("throws for a missing application", () => {
    expect(() => transition(openMemoryDb(), 999, "matched")).toThrow(/not found/);
  });
});

describe("matchNewPostings", () => {
  const settings = { ...defaultSettings(), matchThreshold: 60 };
  const profile = profileWith({ excludedCompanies: c(["Evil Corp"]) });
  const scores: Record<string, number> = { "Engineer 1": 90, "Engineer 2": 59, "Engineer 3": 60 };
  const llm = () => new FakeLlm({ score_relevance: (k) => ({ score: scores[(k as { title: string }).title] ?? 0, reason: "because" }) });

  function statuses(db: ReturnType<typeof openMemoryDb>) {
    return db
      .select({ title: postings.title, status: applications.status, score: applications.matchScore, reason: applications.matchReason })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .orderBy(postings.id)
      .all();
  }

  it("queues at or above the threshold, skips below, and records events", async () => {
    const db = openMemoryDb();
    ingestPostings(db, null, [ing(1), ing(2), ing(3)]);
    const summary = await matchNewPostings(db, { llm: llm(), profile, settings });
    expect(summary).toEqual({ processed: 3, skipped: 1, queued: 2, errors: 0 });
    expect(statuses(db)).toEqual([
      { title: "Engineer 1", status: "queued", score: 90, reason: "because" },
      { title: "Engineer 2", status: "skipped", score: 59, reason: "because" },
      { title: "Engineer 3", status: "queued", score: 60, reason: "because" },
    ]);
    const a1 = db.select().from(applications).innerJoin(postings, eq(postings.id, applications.postingId)).where(eq(postings.title, "Engineer 1")).get()!;
    const path = db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, a1.applications.id)).orderBy(applicationEvents.id).all();
    expect(path.map((e) => [e.fromStatus, e.toStatus])).toEqual([[null, "discovered"], ["discovered", "matched"], ["matched", "queued"]]);
    expect(a1.applications.dryRun).toBe(true);
  });

  it("records hard-filter reasons without calling the LLM", async () => {
    const db = openMemoryDb();
    ingestPostings(db, null, [ing(1, { company: "Evil Corp" })]);
    const fake = llm();
    const summary = await matchNewPostings(db, { llm: fake, profile, settings });
    expect(summary).toMatchObject({ processed: 1, skipped: 1, queued: 0 });
    expect(fake.calls).toHaveLength(0);
    const [row] = statuses(db);
    expect(row).toMatchObject({ status: "skipped" });
    expect(row!.reason).toMatch(/excluded list/);
  });

  it("is idempotent and never creates two applications per posting", async () => {
    const db = openMemoryDb();
    ingestPostings(db, null, [ing(1), ing(2)]);
    await matchNewPostings(db, { llm: llm(), profile, settings });
    const eventsBefore = db.select().from(applicationEvents).all().length;
    const second = await matchNewPostings(db, { llm: llm(), profile, settings });
    expect(second.processed).toBe(0);
    ingestPostings(db, null, [ing(1), ing(2)]);
    await matchNewPostings(db, { llm: llm(), profile, settings });
    expect(db.select().from(applications).all()).toHaveLength(2);
    expect(db.select().from(applicationEvents).all()).toHaveLength(eventsBefore);
  });

  it("leaves the application discovered with lastError on LLM failure, then retries", async () => {
    const db = openMemoryDb();
    ingestPostings(db, null, [ing(1)]);
    const broken = new FakeLlm({ score_relevance: () => { throw new Error("overloaded"); } });
    const summary = await matchNewPostings(db, { llm: broken, profile, settings });
    expect(summary).toMatchObject({ processed: 1, errors: 1, queued: 0 });
    const app = db.select().from(applications).get()!;
    expect(app.status).toBe("discovered");
    expect(app.lastError).toMatch(/overloaded/);
    expect(app.attempts).toBe(1);

    const retry = await matchNewPostings(db, { llm: llm(), profile, settings });
    expect(retry.queued).toBe(1);
    expect(db.select().from(applications).all()).toHaveLength(1);
    const after = db.select().from(applications).get()!;
    expect(after.status).toBe("queued");
    expect(after.lastError).toBeNull();
  });
});

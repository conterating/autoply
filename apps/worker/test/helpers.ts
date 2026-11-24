import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { transition } from "@autoply/core/applications/transition";
import {
  answerPendingQuestion,
  getSettings,
  openDb,
  pendingQuestions,
  saveProfile,
  saveSettings,
  schema,
  type Db,
} from "@autoply/core/db";
import { storeDocument } from "@autoply/core/documents";
import type { Settings } from "@autoply/core";
import { eq } from "drizzle-orm";
import type { BrowserContext } from "playwright";
import { startFixtureServer, FIXTURE_BOARDS, type FixtureServer } from "../../../tests/fixtures/ats/src/index.ts";
import { ADAPTERS } from "../src/adapters.ts";
import { openBrowser } from "../src/browser.ts";
import type { WorkerDeps } from "../src/loop.ts";
import type { AtsAdapter } from "@autoply/ats";
import { prepareApplication, type StepOutcome } from "../src/apply.ts";

export { FIXTURE_BOARDS };

export const RESUME_PATH = resolve(import.meta.dirname, "../../../tests/fixtures/resumes/sample-resume.pdf");

const c = <T>(value: T) => ({ value, confirmedByUser: true });

/** A fully confirmed fictional profile. */
export function confirmedProfile() {
  return {
    version: 1,
    identity: {
      legalFirstName: c("Jordan"),
      legalMiddleName: c(""),
      legalLastName: c("Rivera"),
      preferredName: c(""),
      pronouns: c(""),
      email: c("jordan.rivera@example.com"),
      phoneCountryCode: c("+1"),
      phoneNumber: c("5125550142"),
      addressLine1: c("1200 Congress Ave"),
      addressLine2: c(""),
      city: c("Austin"),
      state: c("TX"),
      postalCode: c("78701"),
      country: c("United States"),
    },
    links: {
      linkedin: c("https://www.linkedin.com/in/jordan-rivera-example"),
      github: c("https://github.com/jordan-rivera-example"),
      portfolio: { value: null, confirmedByUser: false },
      website: c("https://jordanrivera.example.com"),
      other: c([]),
    },
    experience: [
      {
        id: "exp-1",
        company: "Northwind Labs",
        title: "Software Engineering Intern",
        location: "Austin, TX",
        startDate: "2025-06",
        endDate: null,
        current: true,
        bullets: ["Built internal tooling in TypeScript"],
        confirmedByUser: true,
      },
    ],
    education: [
      {
        id: "edu-1",
        school: "University of Texas at Austin",
        degreeLevel: "bachelor",
        degree: "BS Computer Science",
        major: "Computer Science",
        minor: "",
        gpa: 3.6,
        gpaScale: 4,
        startDate: "2023-08",
        graduationDate: "2027-05",
        graduationExpected: true,
        honors: [],
        confirmedByUser: true,
      },
    ],
    skills: c(["TypeScript", "Python", "React"]),
    workAuthorization: {
      authorizedCountries: c([{ country: "US", authorized: true }]),
      requiresSponsorshipNow: c(false),
      requiresSponsorshipFuture: c(false),
      visaType: { value: null, confirmedByUser: false },
      citizenship: c(["US"]),
      securityClearance: { value: null, confirmedByUser: false },
    },
    preferences: {
      targetTitles: c(["Software Engineer"]),
      seniority: c(["entry", "intern", "mid"]),
      locations: c(["United States"]),
      workplaceTypes: c(["remote", "hybrid", "onsite"]),
      willingToRelocate: c(true),
      minimumSalary: { value: null, confirmedByUser: false },
    },
    eeo: {
      gender: c("decline"),
      raceEthnicity: c(["decline"]),
      hispanicLatino: c("decline"),
      veteranStatus: c("not_protected_veteran"),
      disabilityStatus: c("no"),
      sexualOrientation: c("decline"),
      transgender: c("decline"),
    },
    screening: {
      over18: c(true),
      hasCriminalConviction: c(false),
      previousEmployers: c([]),
      relativesAtCompanies: c([]),
      howDidYouHear: c("Company website"),
      willingBackgroundCheck: c(true),
      willingDrugTest: c(true),
      acceptAttestations: c(true),
    },
    onboarding: { currentStep: "review", completedSteps: [], completedAt: new Date().toISOString() },
  };
}

export type Env = {
  home: string;
  db: Db;
  fixture: FixtureServer;
  ctx: BrowserContext;
  deps: WorkerDeps;
};

/** Shared across the file: one fixture server and one browser. */
export type Shared = { fixture: FixtureServer; ctx: BrowserContext; root: string };

export async function startShared(): Promise<Shared> {
  process.env.NODE_ENV = "test";
  const root = resolve(process.cwd(), ".test-data", `worker-${randomUUID().slice(0, 8)}`);
  mkdirSync(root, { recursive: true });
  process.env.AUTOPLY_HOME = root;
  const fixture = await startFixtureServer({ port: 0 });
  const ctx = await openBrowser({ headless: true, userDataDir: join(root, "browser") });
  return { fixture, ctx, root };
}

export async function stopShared(s: Shared | undefined) {
  await s?.ctx.close().catch(() => {});
  await s?.fixture.close().catch(() => {});
}

/** Fresh home, database, profile, resume, settings and sources for one test. */
export async function freshEnv(shared: Shared, settings: Partial<Settings> = {}, adapters: Record<string, AtsAdapter> = ADAPTERS): Promise<Env> {
  const home = join(shared.root, `t-${randomUUID().slice(0, 8)}`);
  mkdirSync(home, { recursive: true });
  process.env.AUTOPLY_HOME = home;
  shared.fixture.reset();
  const db = openDb(join(home, "autoply.db"));
  saveProfile(db, confirmedProfile());
  await storeDocument(db, { kind: "resume", filename: "sample-resume.pdf", bytes: new Uint8Array(readFileSync(RESUME_PATH)), makeDefault: true });
  saveSettings(db, { ...getSettings(db), pacing: { minSeconds: 0, maxSeconds: 0 }, ...settings });
  db.insert(schema.sources)
    .values([
      { ats: "greenhouse", boardToken: "northwind", companyName: "Northwind Labs" },
      { ats: "lever", boardToken: "contoso", companyName: "Contoso Systems" },
      { ats: "ashby", boardToken: "fabrikam", companyName: "Fabrikam AI" },
    ])
    .run();
  const deps: WorkerDeps = {
    db,
    adapters,
    newPage: () => shared.ctx.newPage(),
    llm: null,
    workerId: "test",
    discovery: { baseUrl: shared.fixture.url, backoff: { retries: 0 } },
  };
  return { home, db, fixture: shared.fixture, ctx: shared.ctx, deps };
}

export function setSettings(env: Env, patch: Partial<Settings>) {
  saveSettings(env.db, { ...getSettings(env.db), ...patch });
}

export function postingRow(env: Env, ats: string, externalId: string) {
  return env.db
    .select()
    .from(schema.postings)
    .where(eq(schema.postings.externalId, externalId))
    .all()
    .find((p) => p.ats === ats);
}

export function appFor(env: Env, ats: string, externalId: string) {
  const p = postingRow(env, ats, externalId);
  if (!p) return undefined;
  return env.db.select().from(schema.applications).where(eq(schema.applications.postingId, p.id)).get();
}

export function appById(env: Env, id: number) {
  return env.db.select().from(schema.applications).where(eq(schema.applications.id, id)).get()!;
}

export function events(env: Env, id: number) {
  return env.db.select().from(schema.applicationEvents).where(eq(schema.applicationEvents.applicationId, id)).orderBy(schema.applicationEvents.id).all();
}

/** The plain new-grad posting (first of the board) for an ATS. */
export function plainPostingId(ats: "greenhouse" | "lever" | "ashby"): string {
  return FIXTURE_BOARDS[ats].postings.find((p) => p.kind === "swe-newgrad" && p.variants.length === 0 && !p.closed)!.id;
}

const APPLY_URL = {
  greenhouse: (base: string, id: string) => `${base}/greenhouse/northwind/jobs/${id}`,
  lever: (base: string, id: string) => `${base}/lever/contoso/${id}/apply`,
  ashby: (base: string, id: string) => `${base}/ashby/fabrikam/${id}/application`,
};

/** Inserts a posting + application directly (for variants discovery omits). Returns the application id. */
export function insertApplication(
  env: Env,
  ats: "greenhouse" | "lever" | "ashby",
  externalId: string,
  opts: { matchScore?: number } = {},
): number {
  const board = FIXTURE_BOARDS[ats];
  const title = board.postings.find((p) => p.id === externalId)?.title ?? `Closed posting ${externalId}`;
  const existing = postingRow(env, ats, externalId);
  const url = APPLY_URL[ats](env.fixture.url, externalId);
  const posting =
    existing ??
    env.db
      .insert(schema.postings)
      .values({
        ats,
        externalId,
        company: board.company,
        title,
        location: "Austin, TX",
        workplaceType: "hybrid",
        url,
        applyUrl: url,
        description: "TypeScript and Python new grad role",
        dedupeKey: `${board.company}|${title}|${externalId}`.toLowerCase(),
      })
      .returning()
      .get();
  const app = env.db
    .insert(schema.applications)
    .values({ postingId: posting.id, status: "discovered", matchScore: opts.matchScore ?? 90, dryRun: false })
    .returning()
    .get();
  transition(env.db, app.id, "matched", "test");
  transition(env.db, app.id, "queued", "test");
  return app.id;
}

/** Answers every pending question the way the Needs Input screen does (answer bank + requeue). */
export function answerAllPending(env: Env, answers: (q: { label: string; options: { value: string; label: string }[] | null }) => string): string[] {
  const asked: string[] = [];
  for (const q of pendingQuestions(env.db)) {
    const text = answers({ label: q.label, options: q.options });
    asked.push(q.label);
    const ready = answerPendingQuestion(env.db, { normalizedQuestion: q.normalizedQuestion, label: q.label, text, canonicalKey: q.canonicalKey });
    for (const id of ready) {
      if (appById(env, id).status === "needs_input") transition(env.db, id, "queued", "Your Needs input answers were saved");
    }
  }
  return asked;
}

export function defaultAnswer(q: { label: string; options: { value: string; label: string }[] | null }): string {
  if (/visa/i.test(q.label)) return "N/A";
  if (q.options?.length) return q.options[0]!.label;
  return `Jordan's answer to: ${q.label}`;
}

/** Prepares an application, answering Needs Input questions, until it leaves queued/needs_input. */
export async function prepareToReady(env: Env, applicationId: number, answers = defaultAnswer): Promise<StepOutcome> {
  for (let i = 0; i < 4; i++) {
    const o = await prepareApplication(env.deps, applicationId);
    if (o.status !== "needs_input") return o;
    answerAllPending(env, answers);
  }
  throw new Error(`Application ${applicationId} never left needs_input`);
}


export function approve(env: Env, applicationId: number) {
  env.db.update(schema.applications).set({ approvedAt: new Date().toISOString(), dryRun: false }).where(eq(schema.applications.id, applicationId)).run();
}

/** Withdraws every queued application except the given ones, so a pass only touches the targets. */
export function isolate(env: Env, keep: number[]) {
  for (const a of env.db.select().from(schema.applications).where(eq(schema.applications.status, "queued")).all()) {
    if (!keep.includes(a.id)) transition(env.db, a.id, "withdrawn", "test isolation");
  }
}

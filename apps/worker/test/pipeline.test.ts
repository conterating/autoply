import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AtsAdapter } from "@autoply/ats";
import { transition } from "@autoply/core/applications/transition";
import { getProfile, listApplicationAnswers, pendingQuestions, schema, submittedToday } from "@autoply/core/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADAPTERS } from "../src/adapters.ts";
import { autopilotEligibility, canSubmit, prepareApplication, recoverInterrupted, submitApplication } from "../src/apply.ts";
import { discover, runOnce } from "../src/loop.ts";
import {
  FIXTURE_BOARDS,
  RESUME_PATH,
  answerAllPending,
  appById,
  appFor,
  approve,
  defaultAnswer,
  events,
  freshEnv,
  insertApplication,
  isolate,
  plainPostingId,
  postingRow,
  prepareToReady,
  setSettings,
  startShared,
  stopShared,
  type Env,
  type Shared,
} from "./helpers.ts";

let shared: Shared;
beforeAll(async () => {
  shared = await startShared();
}, 120_000);
afterAll(async () => {
  await stopShared(shared);
});

const T = 120_000;


const subsFor = (env: Env, jobId: string) => env.fixture.submissions().filter((s) => s.jobId === jobId);
const flat = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const screenshotPath = (env: Env, name: string | null) => join(env.home, "screenshots", name ?? "missing");

const ESSAY: Record<string, string> = {
  greenhouse: "Why are you interested in Northwind Labs?",
  lever: "Why are you interested in this role?",
  ashby: "Why do you want to work here?",
};

/** Expected recorded fields (by form input name) for the confirmed profile. */
const DECLINE = /decline/i;
const NO_DISABILITY = /^No, I do not have a disability/;
const NOT_VET = "I am not a protected veteran";
const LINKEDIN = "https://www.linkedin.com/in/jordan-rivera-example";
const EXPECTED: Record<"greenhouse" | "lever" | "ashby", { resumeKey: string; fields: Record<string, string | RegExp> }> = {
  greenhouse: {
    resumeKey: "resume",
    fields: {
      first_name: "Jordan",
      last_name: "Rivera",
      email: "jordan.rivera@example.com",
      phone: "5125550142",
      question_40100001: LINKEDIN,
      question_40100002: "https://jordanrivera.example.com",
      question_40100003: "Yes",
      question_40100004: "No",
      gender: DECLINE,
      hispanic_ethnicity: DECLINE,
      veteran_status: NOT_VET,
      disability_status: NO_DISABILITY,
    },
  },
  lever: {
    resumeKey: "resume",
    fields: {
      name: "Jordan Rivera",
      email: "jordan.rivera@example.com",
      phone: "5125550142",
      "urls[LinkedIn]": LINKEDIN,
      "urls[GitHub]": "https://github.com/jordan-rivera-example",
      "cards[a1b2c3d4-0001-4000-8000-000000000001][field0]": "Yes",
      "cards[a1b2c3d4-0002-4000-8000-000000000002][field0]": "No",
      "eeo[gender]": DECLINE,
      "eeo[race]": DECLINE,
      "eeo[veteran]": NOT_VET,
    },
  },
  ashby: {
    resumeKey: "_systemfield_resume",
    fields: {
      _systemfield_name: "Jordan Rivera",
      _systemfield_email: "jordan.rivera@example.com",
      _systemfield_phone: "5125550142",
      "5d0a1c00-0000-4000-8000-000000000001": LINKEDIN,
      "5d0a1c00-0000-4000-8000-000000000002": "Yes",
      "5d0a1c00-0000-4000-8000-000000000003": "No",
      eeoc_gender: DECLINE,
      eeoc_race: DECLINE,
      eeoc_veteran_status: NOT_VET,
      eeoc_disability_status: NO_DISABILITY,
    },
  },
};

describe("pipeline: full flow per ATS", () => {
  it.each(["greenhouse", "lever", "ashby"] as const)(
    "%s: discover, needs input, ready, approve, submit, confirmed",
    async (ats) => {
      const env = await freshEnv(shared, { dryRun: false });
      const found = await discover(env.deps, { force: true });
      expect(found.found).toBeGreaterThan(0);
      expect(found.matched?.queued).toBeGreaterThan(0);

      const externalId = plainPostingId(ats);
      const app = appFor(env, ats, externalId)!;
      expect(app.status).toBe("queued");
      expect(app.matchScore).toBeGreaterThanOrEqual(60);
      isolate(env, [app.id]);

      // Without an LLM, a required essay lands in Needs Input; an optional one
      // (Greenhouse's) is left blank, as is the optional cover letter upload.
      const essayRequired = ats !== "greenhouse";
      const first = await prepareApplication(env.deps, app.id);
      expect(env.fixture.submissions()).toHaveLength(0);
      if (essayRequired) {
        expect(first.status).toBe("needs_input");
        expect(appById(env, app.id).status).toBe("needs_input");
        expect(pendingQuestions(env.db).map((q) => q.label)).toContain(ESSAY[ats]);
        // Answer like the dashboard does, requeue, prepare again.
        answerAllPending(env, defaultAnswer);
        expect(appById(env, app.id).status).toBe("queued");
        expect(pendingQuestions(env.db)).toHaveLength(0);
        const second = await prepareApplication(env.deps, app.id);
        expect(second.status).toBe("ready");
      } else {
        expect(first.status).toBe("ready");
      }

      const ready = appById(env, app.id);
      expect(ready.preSubmitScreenshot).toBeTruthy();
      expect(existsSync(screenshotPath(env, ready.preSubmitScreenshot))).toBe(true);
      expect(ready.resumeDocumentId).not.toBeNull();
      expect(env.fixture.submissions()).toHaveLength(0);

      approve(env, app.id);
      expect(canSubmit(env.db, app.id)).toMatchObject({ ok: true });
      const sent = await submitApplication(env.deps, app.id);
      expect(sent.status).toBe("confirmed");

      // Recorded submission matches the profile field for field.
      const subs = subsFor(env, externalId);
      expect(subs).toHaveLength(1);
      const sub = subs[0]!;
      expect(sub.ats).toBe(ats);
      for (const [name, want] of Object.entries(EXPECTED[ats].fields)) {
        const got = flat(sub.fields[name]);
        if (typeof want === "string") expect(got, name).toBe(want);
        else expect(got, name).toMatch(want);
      }
      // Cross-check against the stored profile rather than only literals.
      const p = getProfile(env.db);
      const phone = p.identity.phoneNumber.value;
      expect(Object.values(sub.fields).flat()).toContain(phone);
      // The user's Needs Input answer was sent.
      if (essayRequired) expect(Object.values(sub.fields).flat()).toContain(defaultAnswer({ label: ESSAY[ats]!, options: null }));
      // The resume was uploaded with the stored PDF's bytes.
      const file = sub.files[EXPECTED[ats].resumeKey]!;
      expect(file.contentType).toBe("application/pdf");
      expect(file.size).toBe(readFileSync(RESUME_PATH).byteLength);

      // Final DB state.
      const done = appById(env, app.id);
      expect(done.status).toBe("confirmed");
      expect(done.approvedAt).toBeTruthy();
      expect(done.submittedAt).toBeTruthy();
      expect(done.confirmedAt).toBeTruthy();
      expect(done.dryRun).toBe(false);
      expect(done.postSubmitScreenshot).toBeTruthy();
      expect(existsSync(screenshotPath(env, done.postSubmitScreenshot))).toBe(true);
      expect(done.leaseOwner).toBeNull();

      // Every status change has an event, forming one unbroken chain.
      const ev = events(env, app.id);
      expect(ev.map((e) => e.toStatus)).toEqual([
        "discovered",
        "matched",
        "queued",
        "filling",
        ...(essayRequired ? (["needs_input", "queued", "filling"] as const) : []),
        "ready",
        "submitting",
        "submitted",
        "confirmed",
      ]);
      ev.forEach((e, i) => expect(e.fromStatus).toBe(i === 0 ? null : ev[i - 1]!.toStatus));

      // Answers are stored with provenance.
      const answers = listApplicationAnswers(env.db, app.id);
      expect(answers.length).toBeGreaterThan(5);
      for (const a of answers) {
        expect(a.pending).toBe(false);
        if (a.answer !== null) expect(a.source, a.label).toBeTruthy();
        else expect(a.required, `${a.label} is required but has no answer`).toBe(false);
      }
      const sources = new Set(answers.map((a) => a.source));
      expect(sources).toContain("profile");
      expect(sources).toContain("document");
      if (essayRequired) {
        expect(sources).toContain("answer_bank"); // the user's saved answer, reused on the second pass
        const essay = answers.find((a) => a.label === ESSAY[ats])!;
        expect(essay.answerDisplay).toBe(defaultAnswer({ label: ESSAY[ats]!, options: null }));
      }
    },
    T,
  );

  it("uploads the resume under its original filename, not the storage hash", async () => {
    const env = await freshEnv(shared, { dryRun: false });
    const results: Record<string, string> = {};
    for (const ats of ["greenhouse", "lever", "ashby"] as const) {
      const id = insertApplication(env, ats, plainPostingId(ats));
      expect((await prepareToReady(env, id)).status).toBe("ready");
      approve(env, id);
      expect((await submitApplication(env.deps, id)).status).toBe("confirmed");
      results[ats] = subsFor(env, plainPostingId(ats))[0]!.files[EXPECTED[ats].resumeKey]!.filename;
    }
    expect(results).toEqual({ greenhouse: "sample-resume.pdf", lever: "sample-resume.pdf", ashby: "sample-resume.pdf" });
  }, T);

  it("an optional Cover Letter upload does not block Greenhouse when there is no LLM", async () => {
    const env = await freshEnv(shared, { dryRun: false });
    const id = insertApplication(env, "greenhouse", plainPostingId("greenhouse"));
    await prepareApplication(env.deps, id);
    const cover = pendingQuestions(env.db).filter((q) => /cover letter/i.test(q.label));
    expect(cover, "optional cover letter should be skipped, not sent to Needs Input").toHaveLength(0);
  }, T);
});

describe("pipeline: safety properties", () => {
  it("never applies to the same posting twice", async () => {
    const env = await freshEnv(shared, { dryRun: false });
    await discover(env.deps, { force: true });
    const externalId = plainPostingId("lever");
    const app = appFor(env, "lever", externalId)!;
    isolate(env, [app.id]);
    expect((await prepareToReady(env, app.id)).status).toBe("ready");
    approve(env, app.id);
    expect((await runOnce(env.deps, { discover: false })).outcomes[0]?.status).toBe("confirmed");
    expect(subsFor(env, externalId)).toHaveLength(1);

    const postingsBefore = env.db.select().from(schema.postings).all().length;
    const appsBefore = env.db.select().from(schema.applications).all();

    await discover(env.deps, { force: true });
    await discover(env.deps, { force: true });
    for (let i = 0; i < 4; i++) await runOnce(env.deps, { discover: false });
    await runOnce(env.deps); // discovery not due again
    // A second submit attempt on a confirmed application is a no-op failure, never a post.
    await submitApplication(env.deps, app.id).catch(() => undefined);

    const appsAfter = env.db.select().from(schema.applications).all();
    expect(env.db.select().from(schema.postings).all()).toHaveLength(postingsBefore);
    expect(appsAfter.map((a) => a.postingId).sort()).toEqual(appsBefore.map((a) => a.postingId).sort());
    expect(new Set(appsAfter.map((a) => a.postingId)).size).toBe(appsAfter.length);
    expect(appById(env, app.id).status).toBe("confirmed");
    expect(subsFor(env, externalId)).toHaveLength(1);
    expect(env.fixture.submissions().filter((s) => s.ats === "lever" && s.jobId === externalId)).toHaveLength(1);

    // The database itself rejects a second application for a posting.
    const posting = postingRow(env, "lever", externalId)!;
    expect(() => env.db.insert(schema.applications).values({ postingId: posting.id }).run()).toThrow(/UNIQUE/i);
  }, T);

  it("dry run never posts", async () => {
    const env = await freshEnv(shared, { dryRun: true, mode: "review" });
    const id = insertApplication(env, "lever", plainPostingId("lever"));
    expect((await prepareToReady(env, id)).status).toBe("ready");
    approve(env, id);
    const decision = canSubmit(env.db, id);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/dry run/i);
    for (let i = 0; i < 3; i++) {
      const r = await runOnce(env.deps, { discover: false });
      expect(r.outcomes).toHaveLength(0);
    }
    expect(appById(env, id).status).toBe("ready");
    expect(env.fixture.submissions()).toHaveLength(0);
    expect(events(env, id).map((e) => e.toStatus)).not.toContain("submitting");
    // The explicit --dry-run flag overrides settings too.
    setSettings(env, { dryRun: false });
    expect((await runOnce(env.deps, { discover: false, dryRun: true })).outcomes).toHaveLength(0);
    expect(env.fixture.submissions()).toHaveLength(0);
    expect(canSubmit(env.db, id, { dryRun: false }).ok).toBe(true);
  }, T);

  it("autopilot submits above the match bar and falls back to review below it", async () => {
    const env = await freshEnv(shared, { dryRun: false, mode: "autopilot", autopilotMatchThreshold: 75 });
    const high = insertApplication(env, "lever", FIXTURE_BOARDS.lever.postings[0]!.id, { matchScore: 90 });
    const low = insertApplication(env, "lever", FIXTURE_BOARDS.lever.postings[1]!.id, { matchScore: 50 });
    expect((await prepareToReady(env, high)).status).toBe("ready");
    expect((await prepareToReady(env, low)).status).toBe("ready");
    expect(appById(env, high).autopilotEligible).toBe(true);
    expect(appById(env, low).autopilotEligible).toBe(false);
    expect(appById(env, high).approvedAt).toBeNull();

    const r = await runOnce(env.deps, { discover: false });
    expect(r.outcomes.map((o) => o.applicationId)).toEqual([high]);
    expect(appById(env, high).status).toBe("confirmed");
    expect(appById(env, high).approvedAt).toBeNull();
    expect(subsFor(env, FIXTURE_BOARDS.lever.postings[0]!.id)).toHaveLength(1);

    for (let i = 0; i < 3; i++) await runOnce(env.deps, { discover: false });
    expect(appById(env, low).status).toBe("ready");
    expect(canSubmit(env.db, low).reason).toMatch(/review/i);
    expect(subsFor(env, FIXTURE_BOARDS.lever.postings[1]!.id)).toHaveLength(0);

    approve(env, low);
    expect((await runOnce(env.deps, { discover: false })).outcomes[0]?.status).toBe("confirmed");
    expect(subsFor(env, FIXTURE_BOARDS.lever.postings[1]!.id)).toHaveLength(1);
  }, T);

  it("enforces the daily cap and ignores dry-run submissions", async () => {
    const env = await freshEnv(shared, { dryRun: false, mode: "review", dailyCap: 1 });
    const a = insertApplication(env, "lever", FIXTURE_BOARDS.lever.postings[0]!.id);
    const b = insertApplication(env, "lever", FIXTURE_BOARDS.lever.postings[1]!.id);
    expect((await prepareToReady(env, a)).status).toBe("ready");
    expect((await prepareToReady(env, b)).status).toBe("ready");
    approve(env, a);
    approve(env, b);

    const first = await runOnce(env.deps, { discover: false });
    expect(first.outcomes).toHaveLength(1);
    expect(first.outcomes[0]!.status).toBe("confirmed");
    for (let i = 0; i < 3; i++) expect((await runOnce(env.deps, { discover: false })).outcomes).toHaveLength(0);
    expect(env.fixture.submissions()).toHaveLength(1);
    const left = [a, b].find((id) => appById(env, id).status === "ready")!;
    expect(canSubmit(env.db, left)).toMatchObject({ ok: false });
    expect(canSubmit(env.db, left).reason).toMatch(/limit.*reached/i);
    expect(submittedToday(env.db)).toBe(1);

    // Dry-run "submissions" don't count toward the cap.
    const c = insertApplication(env, "lever", FIXTURE_BOARDS.lever.postings[2]!.id);
    env.db.update(schema.applications).set({ submittedAt: new Date().toISOString(), dryRun: true }).where(eq(schema.applications.id, c)).run();
    expect(submittedToday(env.db)).toBe(1);
    setSettings(env, { dailyCap: 2 });
    expect(canSubmit(env.db, left).ok).toBe(true);
    expect((await runOnce(env.deps, { discover: false })).outcomes[0]?.status).toBe("confirmed");
    expect(env.fixture.submissions()).toHaveLength(2);
    expect(submittedToday(env.db)).toBe(2);
  }, T);

  it("ends in needs_user at the CAPTCHA variant and posts nothing", async () => {
    const env = await freshEnv(shared, { dryRun: false });
    const id = insertApplication(env, "lever", FIXTURE_BOARDS.lever.variants.captcha);
    let out = await prepareToReady(env, id);
    if (out.status === "ready") {
      approve(env, id);
      out = await submitApplication(env.deps, id);
    }
    expect(out.status).toBe("needs_user");
    const row = appById(env, id);
    expect(row.status).toBe("needs_user");
    expect(row.needsUserReason).toMatch(/captcha/i);
    expect(env.fixture.submissions()).toHaveLength(0);
    // Never retried automatically.
    for (let i = 0; i < 2; i++) await runOnce(env.deps, { discover: false });
    expect(appById(env, id).status).toBe("needs_user");
    expect(env.fixture.submissions()).toHaveLength(0);
  }, T);

  it("fails a closed posting and records closedAt", async () => {
    const env = await freshEnv(shared, { dryRun: false });
    const id = insertApplication(env, "greenhouse", FIXTURE_BOARDS.greenhouse.variants.closed);
    const r = await runOnce(env.deps, { discover: false });
    expect(r.outcomes[0]).toMatchObject({ applicationId: id, status: "failed" });
    const row = appById(env, id);
    expect(row.status).toBe("failed");
    expect(row.lastError).toBeTruthy();
    expect(postingRow(env, "greenhouse", FIXTURE_BOARDS.greenhouse.variants.closed)!.closedAt).toBeTruthy();
    expect(env.fixture.submissions()).toHaveLength(0);
    expect((await runOnce(env.deps, { discover: false })).outcomes).toHaveLength(0);
  }, T);

  it("fails on a server error, records nothing, and does not retry automatically", async () => {
    const env = await freshEnv(shared, { dryRun: false });
    const id = insertApplication(env, "greenhouse", FIXTURE_BOARDS.greenhouse.variants.serverError);
    expect((await prepareToReady(env, id)).status).toBe("ready");
    approve(env, id);
    const r = await runOnce(env.deps, { discover: false });
    expect(r.outcomes[0]).toMatchObject({ applicationId: id, status: "failed" });
    const row = appById(env, id);
    expect(row.status).toBe("failed");
    expect(row.lastError).toBeTruthy();
    expect(row.submittedAt).toBeNull();
    expect(env.fixture.submissions()).toHaveLength(0);
    const attempts = row.attempts;
    for (let i = 0; i < 3; i++) expect((await runOnce(env.deps, { discover: false })).outcomes).toHaveLength(0);
    expect(appById(env, id).status).toBe("failed");
    expect(appById(env, id).attempts).toBe(attempts);
    expect(env.fixture.submissions()).toHaveLength(0);
  }, T);

  it("refuses to submit to a non-localhost origin under NODE_ENV=test", async () => {
    const env = await freshEnv(shared, { dryRun: false });
    const jobId = plainPostingId("greenhouse");
    const id = insertApplication(env, "greenhouse", jobId);
    expect((await prepareToReady(env, id)).status).toBe("ready");
    approve(env, id);

    const posting = postingRow(env, "greenhouse", jobId)!;
    const fake = `https://boards.greenhouse.io/northwind/jobs/${jobId}`;
    env.db.update(schema.postings).set({ applyUrl: fake, url: fake }).where(eq(schema.postings.id, posting.id)).run();
    const html = await (await fetch(`${env.fixture.url}/greenhouse/northwind/jobs/${jobId}`)).text();
    let hits = 0;
    await env.ctx.route("https://boards.greenhouse.io/**", async (route) => {
      if (route.request().method() === "POST") return route.abort();
      hits++;
      await route.fulfill({ status: 200, contentType: "text/html", body: html });
    });
    try {
      const out = await submitApplication(env.deps, id);
      expect(hits).toBeGreaterThan(0);
      expect(out.status).toBe("ready");
      expect(out.detail).toMatch(/Refusing to submit/);
    } finally {
      await env.ctx.unroute("https://boards.greenhouse.io/**");
    }
    const row = appById(env, id);
    expect(row.status).toBe("ready");
    expect(row.lastError).toMatch(/Refusing to submit/);
    expect(row.submittedAt).toBeNull();
    expect(events(env, id).map((e) => e.toStatus)).not.toContain("submitting");
    expect(env.fixture.submissions()).toHaveLength(0);
  }, T);
});

describe("pipeline: crash recovery", () => {
  it("reclaims a filling application with an expired lease and prepares it normally", async () => {
    const env = await freshEnv(shared, { dryRun: false });
    const id = insertApplication(env, "lever", plainPostingId("lever"));
    transition(env.db, id, "filling", "crashed worker", { leaseOwner: "dead-worker", leaseExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    expect(recoverInterrupted(env.db)).toEqual({ reclaimed: 1, flagged: 0 });
    expect(appById(env, id)).toMatchObject({ status: "queued", leaseOwner: null, leaseExpiresAt: null });

    const r = await runOnce(env.deps, { discover: false });
    expect(r.outcomes[0]).toMatchObject({ applicationId: id });
    expect(["needs_input", "ready"]).toContain(r.outcomes[0]!.status);
    if (r.outcomes[0]!.status === "needs_input") {
      answerAllPending(env, defaultAnswer);
      expect((await prepareToReady(env, id)).status).toBe("ready");
    }
    expect(appById(env, id).status).toBe("ready");
    expect(env.fixture.submissions()).toHaveLength(0);
  }, T);

  it("does not reclaim a filling application whose lease is still live", async () => {
    const env = await freshEnv(shared);
    const id = insertApplication(env, "lever", plainPostingId("lever"));
    transition(env.db, id, "filling", "live worker", { leaseOwner: "other", leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(recoverInterrupted(env.db)).toEqual({ reclaimed: 0, flagged: 0 });
    expect(appById(env, id).status).toBe("filling");
  }, T);

  it("flags an application left in submitting as needs_user and never re-sends it", async () => {
    const env = await freshEnv(shared, { dryRun: false });
    const id = insertApplication(env, "lever", plainPostingId("lever"));
    expect((await prepareToReady(env, id)).status).toBe("ready");
    approve(env, id);
    transition(env.db, id, "submitting", "Clicking submit", { dryRun: false });

    expect(recoverInterrupted(env.db)).toEqual({ reclaimed: 0, flagged: 1 });
    expect(appById(env, id).status).toBe("needs_user");
    expect(appById(env, id).needsUserReason).toMatch(/went through/i);
    for (let i = 0; i < 3; i++) expect((await runOnce(env.deps, { discover: false })).outcomes).toHaveLength(0);
    expect(appById(env, id).status).toBe("needs_user");
    expect(env.fixture.submissions()).toHaveLength(0);
  }, T);

  it("a crash mid-submit leaves needs_user, exactly one submission, and no second one", async () => {
    const real = ADAPTERS.lever!;
    const crashing: AtsAdapter = {
      ...real,
      async submit(page) {
        await real.submit(page);
        throw new Error("worker crashed right after the click");
      },
    };
    const env = await freshEnv(shared, { dryRun: false }, { ...ADAPTERS, lever: crashing });
    const jobId = plainPostingId("lever");
    const id = insertApplication(env, "lever", jobId);
    expect((await prepareToReady(env, id)).status).toBe("ready");
    approve(env, id);

    const r = await runOnce(env.deps, { discover: false });
    expect(r.outcomes[0]).toMatchObject({ applicationId: id, status: "needs_user" });
    const row = appById(env, id);
    expect(row.status).toBe("needs_user");
    expect(row.lastError).toMatch(/crashed/);
    expect(row.needsUserReason).toMatch(/unclear/i);
    expect(subsFor(env, jobId)).toHaveLength(1);
    expect(events(env, id).map((e) => e.toStatus).slice(-2)).toEqual(["submitting", "needs_user"]);

    for (let i = 0; i < 3; i++) expect((await runOnce(env.deps, { discover: false })).outcomes).toHaveLength(0);
    expect(appById(env, id).status).toBe("needs_user");
    expect(subsFor(env, jobId)).toHaveLength(1);
    expect(env.fixture.submissions()).toHaveLength(1);
  }, T);
});

describe("autopilotEligibility", () => {
  const settings = { autopilotMatchThreshold: 75, answerConfidenceThreshold: 0.85 };
  const field = { id: "f1", label: "Work authorization", type: "text" as const, required: true };
  const base = {
    fieldId: "f1",
    label: "Work authorization",
    normalizedQuestion: "work authorization",
    canonicalKey: "work_auth",
    category: null,
    sensitive: false,
    status: "answered" as const,
    answer: { kind: "text" as const, value: "Yes" },
    reason: "",
  };

  it("rejects an LLM-matched required answer", () => {
    const res = autopilotEligibility([field], [{ ...base, source: "profile", matchedBy: "llm", confidence: 0.9 }], { matchScore: 90, settings });
    expect(res.eligible).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/90%/);
  });

  it("accepts a high-confidence pattern match", () => {
    const res = autopilotEligibility([field], [{ ...base, source: "profile", matchedBy: "pattern", confidence: 0.95 }], { matchScore: 90, settings });
    expect(res).toEqual({ eligible: true, reasons: [] });
  });

  it("rejects a pattern match below 0.95", () => {
    const res = autopilotEligibility([field], [{ ...base, source: "profile", matchedBy: "pattern", confidence: 0.9 }], { matchScore: 90, settings });
    expect(res.eligible).toBe(false);
  });

  it("accepts an answer-bank answer", () => {
    const res = autopilotEligibility([field], [{ ...base, source: "answer_bank", matchedBy: "none", confidence: 1 }], { matchScore: 90, settings });
    expect(res.eligible).toBe(true);
  });

  it("rejects an unanswered required field but ignores an unanswered optional one", () => {
    const needs = { ...base, status: "needs_input" as const, answer: undefined, matchedBy: "none" as const, confidence: 0 };
    expect(autopilotEligibility([field], [needs], { matchScore: 90, settings })).toMatchObject({ eligible: false });
    const optional = { ...field, required: false };
    expect(autopilotEligibility([optional], [needs], { matchScore: 90, settings }).eligible).toBe(true);
  });

  it("rejects a match score below the bar", () => {
    const res = autopilotEligibility([field], [{ ...base, source: "answer_bank", matchedBy: "none", confidence: 1 }], { matchScore: 74, settings });
    expect(res.eligible).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/below the autopilot bar/);
    expect(autopilotEligibility([field], [{ ...base, source: "answer_bank", matchedBy: "none", confidence: 1 }], { matchScore: null, settings }).eligible).toBe(false);
  });
});

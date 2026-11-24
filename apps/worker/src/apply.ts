import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AtsAdapter, FieldAnswer, FormField } from "@autoply/ats";
import { transition } from "@autoply/core/applications/transition";
import {
  getProfile,
  getSettings,
  listApplicationAnswers,
  markAnswerUsed,
  saveResolutions,
  schema,
  submittedToday,
  type Db,
} from "@autoply/core/db";
import { defaultResume, documentPath, listDocuments } from "@autoply/core/documents";
import type { Llm } from "@autoply/core/llm";
import { ensureDataDirs } from "@autoply/core/paths";
import { resolveForm, type Resolution } from "@autoply/core/resolver";
import { draftVerified } from "@autoply/core/writing";
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Page } from "playwright";
import { assertSubmitAllowed } from "./submit-guard.ts";

export type ApplyDeps = {
  db: Db;
  adapters: Record<string, AtsAdapter>;
  /** Opens a fresh page in the worker's persistent browser context. */
  newPage: () => Promise<Page>;
  llm: Llm | null;
  workerId: string;
  now?: () => Date;
  /** Keep pages that need the user open so they can finish by hand. */
  keepBlockedPagesOpen?: boolean;
};

export type StepOutcome = { applicationId: number; status: string; detail: string };

const LEASE_MS = 10 * 60 * 1000;

function load(db: Db, applicationId: number) {
  const row = db
    .select()
    .from(schema.applications)
    .innerJoin(schema.postings, eq(schema.postings.id, schema.applications.postingId))
    .where(eq(schema.applications.id, applicationId))
    .get();
  if (!row) throw new Error(`Application ${applicationId} not found`);
  return { app: row.applications, posting: row.postings };
}

async function screenshot(page: Page, applicationId: number, kind: "pre" | "post"): Promise<string> {
  const name = `app-${applicationId}-${kind}-${Date.now()}.png`;
  await page.screenshot({ path: join(ensureDataDirs().screenshots, name), fullPage: true });
  return name;
}

function countryOf(location: string): string | undefined {
  if (/\b(canada|toronto|vancouver|montreal)\b/i.test(location)) return "CA";
  if (/\b(united kingdom|uk|london|england)\b/i.test(location)) return "GB";
  if (/\b(germany|berlin|munich)\b/i.test(location)) return "DE";
  if (/\b(india|bangalore|bengaluru|hyderabad)\b/i.test(location)) return "IN";
  return undefined;
}

async function coverLetterPdf(text: string, applicationId: number, company: string): Promise<{ path: string; filename: string }> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const size = 11;
  const width = 612 - 72 * 2;
  let page = pdf.addPage([612, 792]);
  let y = 792 - 72;
  // pdf-lib's standard fonts can't encode everything; keep to WinAnsi.
  const safe = text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\n\xA0-\xFF]/g, "");
  for (const para of safe.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    const flush = () => {
      if (y < 72) {
        page = pdf.addPage([612, 792]);
        y = 792 - 72;
      }
      page.drawText(line, { x: 72, y, size, font });
      y -= size * 1.45;
      line = "";
    };
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width) flush();
      line = line ? `${line} ${w}` : w;
    }
    if (line) flush();
    else y -= size * 1.45;
  }
  const dir = join(ensureDataDirs().home, "generated");
  mkdirSync(dir, { recursive: true });
  const filename = `Cover Letter - ${company.replace(/[^\w .-]/g, "")}.pdf`;
  const path = join(dir, `cover-letter-${applicationId}.pdf`);
  writeFileSync(path, await pdf.save());
  return { path, filename };
}

function answersMap(resolutions: Resolution[]): Map<string, FieldAnswer> {
  const m = new Map<string, FieldAnswer>();
  for (const r of resolutions) if (r.status === "answered" && r.answer) m.set(r.fieldId, r.answer);
  return m;
}

/**
 * queued → filling → needs_input | needs_user | ready | failed.
 * Opens the form, resolves every field, drafts and verifies free text, fills
 * the form (handling fields revealed by earlier answers), screenshots it.
 */
export async function prepareApplication(deps: ApplyDeps, applicationId: number): Promise<StepOutcome> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const { app, posting } = load(db, applicationId);
  const adapter = deps.adapters[posting.ats];
  if (!adapter) {
    transition(db, applicationId, "filling", null, { leaseOwner: deps.workerId, leaseExpiresAt: new Date(now().getTime() + LEASE_MS).toISOString() });
    transition(db, applicationId, "failed", `No adapter for ${posting.ats}`, { leaseOwner: null, leaseExpiresAt: null, lastError: `Unsupported ATS: ${posting.ats}` });
    return { applicationId, status: "failed", detail: `Unsupported ATS: ${posting.ats}` };
  }

  transition(db, applicationId, "filling", "Opening the application form", {
    leaseOwner: deps.workerId,
    leaseExpiresAt: new Date(now().getTime() + LEASE_MS).toISOString(),
    attempts: app.attempts + 1,
    lastError: null,
  });
  const release = { leaseOwner: null, leaseExpiresAt: null };

  const page = await deps.newPage();
  let keepOpen = false;
  try {
    const state = await adapter.open(page, posting.applyUrl);
    if (state.kind === "closed") {
      db.update(schema.postings).set({ closedAt: now().toISOString() }).where(eq(schema.postings.id, posting.id)).run();
      transition(db, applicationId, "failed", state.message, { ...release, lastError: state.message });
      return { applicationId, status: "failed", detail: state.message };
    }
    if (state.kind === "blocked") {
      keepOpen = Boolean(deps.keepBlockedPagesOpen);
      transition(db, applicationId, "needs_user", state.message, { ...release, needsUserReason: state.message });
      return { applicationId, status: "needs_user", detail: state.message };
    }

    const profile = getProfile(db);
    const settings = getSettings(db);
    const resume = defaultResume(db);
    const transcript = listDocuments(db).find((d) => d.kind === "transcript" && d.isDefault) ?? listDocuments(db).find((d) => d.kind === "transcript");
    const ctx = {
      profile,
      company: posting.company,
      jobCountry: countryOf(posting.location),
      today: now(),
      threshold: settings.answerConfidenceThreshold,
      llm: deps.llm,
      findBankAnswer: (normalized: string) => {
        const row = db.select().from(schema.answerBank).where(eq(schema.answerBank.normalizedQuestion, normalized)).get();
        return row ? { id: row.id, text: (row.answer as { text: string }).text } : null;
      },
      documents: {
        resume: resume ? { path: documentPath(resume), filename: resume.filename } : null,
        transcript: transcript ? { path: documentPath(transcript), filename: transcript.filename } : null,
      },
    };

    const job = { company: posting.company, title: posting.title, description: posting.description };
    let coverLetter: string | null = app.coverLetter;
    let coverLetterFile: { path: string; filename: string } | null = null;

    async function draft(resolutions: Resolution[], fields: FormField[]): Promise<Resolution[]> {
      const byId = new Map(fields.map((f) => [f.id, f]));
      const out: Resolution[] = [];
      for (const r of resolutions) {
        if (r.status !== "needs_draft") {
          out.push(r);
          continue;
        }
        if (!deps.llm) {
          out.push({ ...r, status: "needs_input", reason: "No Claude API key, so this can’t be written for you" });
          continue;
        }
        const field = byId.get(r.fieldId)!;
        if (r.canonicalKey === "cover_letter") {
          if (!coverLetter) {
            const d = await draftVerified(deps.llm, { kind: "cover_letter", profile, job });
            if (d.status !== "ok") {
              out.push({ ...r, status: "needs_input", reason: `Cover letter didn’t pass fact-checking: ${d.reason}` });
              continue;
            }
            coverLetter = d.text;
          }
          if (field.type === "file") {
            coverLetterFile ??= await coverLetterPdf(coverLetter, applicationId, posting.company);
            out.push({ ...r, status: "answered", answer: { kind: "file", ...coverLetterFile }, display: coverLetterFile.filename, source: "llm_draft", reason: "Cover letter written for this job and fact-checked" });
          } else {
            out.push({ ...r, status: "answered", answer: { kind: "text", value: coverLetter }, display: coverLetter, source: "llm_draft", reason: "Cover letter written for this job and fact-checked" });
          }
          continue;
        }
        const d = await draftVerified(deps.llm, { kind: "answer", profile, question: field.label, job, maxLength: field.type === "text" ? 300 : 1500 });
        if (d.status === "ok") {
          out.push({ ...r, status: "answered", answer: { kind: "text", value: d.text }, display: d.text, source: "llm_draft", reason: "Written from your profile and fact-checked" });
        } else {
          out.push({ ...r, status: field.required ? "needs_input" : "skipped", reason: d.reason });
        }
      }
      return out;
    }

    // Resolve, fill, and re-extract to catch fields revealed by earlier answers.
    let fields = await adapter.extractForm(page);
    let resolutions = await draft(await resolveForm(fields, ctx), fields);
    for (let round = 0; round < 3; round++) {
      if (resolutions.some((r) => r.status === "needs_input")) break;
      await adapter.fill(page, answersMap(resolutions));
      const after = await adapter.extractForm(page);
      const known = new Set(fields.map((f) => f.id));
      const added = after.filter((f) => !known.has(f.id));
      if (!added.length) break;
      fields = [...fields, ...added];
      resolutions = [...resolutions, ...(await draft(await resolveForm(added, ctx), added))];
    }

    saveResolutions(db, applicationId, fields, resolutions);
    for (const r of resolutions) {
      if (r.source === "answer_bank") {
        const hit = ctx.findBankAnswer(r.normalizedQuestion);
        if (hit) markAnswerUsed(db, hit.id);
      }
    }
    const pending = resolutions.filter((r) => r.status === "needs_input");
    const resumeDocumentId = resume?.id ?? null;
    if (pending.length) {
      transition(db, applicationId, "needs_input", `${pending.length} ${pending.length === 1 ? "question needs" : "questions need"} your answer`, {
        ...release,
        coverLetter,
        resumeDocumentId,
      });
      return { applicationId, status: "needs_input", detail: pending.map((p) => p.label).join("; ") };
    }

    const pre = await screenshot(page, applicationId, "pre");
    const requiredOk = resolutions.every((r) => {
      const f = fields.find((x) => x.id === r.fieldId);
      return !f?.required || (r.status === "answered" && (r.source !== "profile" || r.confidence >= settings.answerConfidenceThreshold));
    });
    const autopilotEligible = requiredOk && (app.matchScore ?? 0) >= settings.autopilotMatchThreshold;
    transition(db, applicationId, "ready", "Filled and ready for review", {
      ...release,
      preSubmitScreenshot: pre,
      coverLetter,
      resumeDocumentId,
      autopilotEligible,
    });
    return { applicationId, status: "ready", detail: autopilotEligible ? "Ready (autopilot eligible)" : "Ready for review" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      transition(db, applicationId, "failed", message, { ...release, lastError: message });
    } catch {
      // already moved on
    }
    return { applicationId, status: "failed", detail: message };
  } finally {
    if (!keepOpen) await page.close().catch(() => {});
  }
}

export type SubmitDecision = { ok: true; reason: string } | { ok: false; reason: string };

/** Whether a `ready` application may be submitted now. */
export function canSubmit(db: Db, applicationId: number, opts: { dryRun?: boolean } = {}): SubmitDecision {
  const settings = getSettings(db);
  const { app } = load(db, applicationId);
  if (app.status !== "ready") return { ok: false, reason: `Status is ${app.status}` };
  if (opts.dryRun ?? settings.dryRun) return { ok: false, reason: "Dry run is on" };
  if (submittedToday(db) >= settings.dailyCap) return { ok: false, reason: `Daily limit of ${settings.dailyCap} reached` };
  if (app.approvedAt) return { ok: true, reason: "Approved by you" };
  if (settings.mode === "autopilot" && app.autopilotEligible) return { ok: true, reason: "Autopilot" };
  return { ok: false, reason: settings.mode === "autopilot" ? "Not autopilot-eligible; waiting for your review" : "Waiting for your review" };
}

/**
 * ready → submitting → submitted → confirmed (or needs_user / failed / queued).
 * Refills the form from the stored answers, then clicks submit. `submitting`
 * is written before the click and is never retried automatically.
 */
export async function submitApplication(deps: ApplyDeps, applicationId: number): Promise<StepOutcome> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const { app, posting } = load(db, applicationId);
  const adapter = deps.adapters[posting.ats];
  if (!adapter) return { applicationId, status: app.status, detail: `Unsupported ATS: ${posting.ats}` };

  const page = await deps.newPage();
  let keepOpen = false;
  let clicked = false;
  try {
    const state = await adapter.open(page, posting.applyUrl);
    if (state.kind === "closed") {
      transition(db, applicationId, "failed", state.message, { lastError: state.message });
      return { applicationId, status: "failed", detail: state.message };
    }
    if (state.kind === "blocked") {
      keepOpen = Boolean(deps.keepBlockedPagesOpen);
      transition(db, applicationId, "needs_user", state.message, { needsUserReason: state.message });
      return { applicationId, status: "needs_user", detail: state.message };
    }

    const stored = listApplicationAnswers(db, applicationId);
    const fields = await adapter.extractForm(page);
    const storedIds = new Set(stored.map((s) => s.fieldId));
    const unknownRequired = fields.filter((f) => f.required && !storedIds.has(f.id));
    if (unknownRequired.length) {
      transition(db, applicationId, "queued", `The form changed (${unknownRequired.map((f) => f.label).join(", ")}); preparing again`);
      return { applicationId, status: "queued", detail: "Form changed" };
    }
    const answers = new Map<string, FieldAnswer>();
    for (const s of stored) if (s.answer && !s.pending) answers.set(s.fieldId, s.answer as FieldAnswer);
    await adapter.fill(page, answers);

    // Hard rule 4: refuse to submit to a real employer from tests.
    assertSubmitAllowed(page.url());

    transition(db, applicationId, "submitting", "Clicking submit", { dryRun: false });
    clicked = true;
    const outcome = await adapter.submit(page);
    if (!outcome.ok) {
      if (outcome.reason === "captcha" || outcome.reason === "verification") {
        keepOpen = Boolean(deps.keepBlockedPagesOpen);
        transition(db, applicationId, "needs_user", outcome.message, { needsUserReason: outcome.message });
        return { applicationId, status: "needs_user", detail: outcome.message };
      }
      transition(db, applicationId, "failed", outcome.message, { lastError: outcome.message });
      return { applicationId, status: "failed", detail: outcome.message };
    }
    const post = await screenshot(page, applicationId, "post");
    transition(db, applicationId, "submitted", "Submitted", { submittedAt: now().toISOString(), postSubmitScreenshot: post });
    if (await adapter.confirmSubmitted(page)) {
      transition(db, applicationId, "confirmed", "Confirmation page shown", { confirmedAt: now().toISOString() });
      return { applicationId, status: "confirmed", detail: "Submitted and confirmed" };
    }
    return { applicationId, status: "submitted", detail: "Submitted; no confirmation page detected" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const current = load(db, applicationId).app.status;
    if (current === "submitting") {
      // We may or may not have sent it. Never retry automatically.
      transition(db, applicationId, "needs_user", `Autoply hit an error while sending (${message}). Check whether it went through.`, {
        needsUserReason: "Unclear whether the submission went through",
        lastError: message,
      });
      return { applicationId, status: "needs_user", detail: message };
    }
    if (!clicked && current === "ready") {
      db.update(schema.applications).set({ lastError: message }).where(eq(schema.applications.id, applicationId)).run();
    }
    return { applicationId, status: current, detail: message };
  } finally {
    if (!keepOpen) await page.close().catch(() => {});
  }
}

/**
 * Crash recovery, run at worker start and each tick: reclaims `filling`
 * applications whose lease expired, and flags any `submitting` application
 * (left mid-click by a crash) for the user instead of retrying it.
 */
export function recoverInterrupted(db: Db, now = new Date(), opts: { includeLive?: boolean } = {}) {
  const rows = db.select().from(schema.applications).all();
  let reclaimed = 0;
  let flagged = 0;
  for (const a of rows) {
    if (a.status === "filling" && (opts.includeLive || !a.leaseExpiresAt || Date.parse(a.leaseExpiresAt) < now.getTime())) {
      transition(db, a.id, "queued", "Worker stopped while filling; trying again", { leaseOwner: null, leaseExpiresAt: null });
      reclaimed++;
    } else if (a.status === "submitting" && (opts.includeLive || !a.leaseOwner)) {
      transition(db, a.id, "needs_user", "Autoply stopped while sending. Check whether the application went through.", {
        needsUserReason: "Unclear whether the submission went through",
      });
      flagged++;
    }
  }
  return { reclaimed, flagged };
}

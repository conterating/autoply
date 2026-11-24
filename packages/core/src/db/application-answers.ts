import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { Resolution } from "../resolver/resolve.ts";
import type { FormField } from "../resolver/types.ts";
import { upsertAnswer } from "./answer-bank.ts";
import type { Db } from "./index.ts";
import { applicationAnswers, applications, postings } from "./schema.ts";

const nowSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Replaces the stored answers for an application with a fresh resolution of its form. */
export function saveResolutions(db: Db, applicationId: number, fields: FormField[], resolutions: Resolution[]) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  db.transaction((tx) => {
    tx.delete(applicationAnswers).where(eq(applicationAnswers.applicationId, applicationId)).run();
    resolutions.forEach((r, position) => {
      const f = byId.get(r.fieldId);
      tx.insert(applicationAnswers)
        .values({
          applicationId,
          fieldId: r.fieldId,
          label: r.label,
          helpText: f?.helpText ?? null,
          fieldType: f?.type ?? "text",
          required: f?.required ?? false,
          options: f?.options ?? null,
          normalizedQuestion: r.normalizedQuestion,
          canonicalKey: r.canonicalKey,
          answer: r.answer ?? null,
          answerDisplay: r.display ?? null,
          source: r.source ?? null,
          confidence: r.confidence,
          reason: r.reason,
          pending: r.status === "needs_input",
          position,
        })
        .run();
    });
  });
}

export function listApplicationAnswers(db: Db, applicationId: number) {
  return db.select().from(applicationAnswers).where(eq(applicationAnswers.applicationId, applicationId)).orderBy(asc(applicationAnswers.position)).all();
}

/** Updates one stored answer (e.g. after drafting a cover letter or the user answering). */
export function setApplicationAnswer(
  db: Db,
  applicationId: number,
  fieldId: string,
  patch: { answer: unknown; answerDisplay: string; source: "llm_draft" | "user" | "answer_bank" | "profile"; reason?: string; pending?: boolean },
) {
  db.update(applicationAnswers)
    .set({ answer: patch.answer, answerDisplay: patch.answerDisplay, source: patch.source, reason: patch.reason, pending: patch.pending ?? false, updatedAt: nowSql })
    .where(and(eq(applicationAnswers.applicationId, applicationId), eq(applicationAnswers.fieldId, fieldId)))
    .run();
}

export type PendingQuestion = {
  normalizedQuestion: string;
  label: string;
  helpText: string | null;
  fieldType: string;
  options: { value: string; label: string }[] | null;
  canonicalKey: string | null;
  reason: string | null;
  /** Applications currently blocked on this question. */
  blocking: number;
  example: { applicationId: number; company: string; title: string; url: string };
};

/**
 * Questions waiting on the user, grouped by normalized wording so one answer
 * unblocks every application asking the same thing. Most-blocking first.
 */
export function pendingQuestions(db: Db): PendingQuestion[] {
  const rows = db
    .select({
      normalizedQuestion: applicationAnswers.normalizedQuestion,
      label: applicationAnswers.label,
      helpText: applicationAnswers.helpText,
      fieldType: applicationAnswers.fieldType,
      options: applicationAnswers.options,
      canonicalKey: applicationAnswers.canonicalKey,
      reason: applicationAnswers.reason,
      applicationId: applicationAnswers.applicationId,
      company: postings.company,
      title: postings.title,
      url: postings.url,
    })
    .from(applicationAnswers)
    .innerJoin(applications, eq(applications.id, applicationAnswers.applicationId))
    .innerJoin(postings, eq(postings.id, applications.postingId))
    .where(and(eq(applicationAnswers.pending, true), eq(applications.status, "needs_input")))
    .orderBy(asc(applicationAnswers.id))
    .all();

  const groups = new Map<string, PendingQuestion & { apps: Set<number> }>();
  for (const r of rows) {
    const g = groups.get(r.normalizedQuestion);
    if (g) {
      g.apps.add(r.applicationId);
      continue;
    }
    groups.set(r.normalizedQuestion, {
      normalizedQuestion: r.normalizedQuestion,
      label: r.label,
      helpText: r.helpText,
      fieldType: r.fieldType,
      options: (r.options as PendingQuestion["options"]) ?? null,
      canonicalKey: r.canonicalKey,
      reason: r.reason,
      blocking: 0,
      example: { applicationId: r.applicationId, company: r.company, title: r.title, url: r.url },
      apps: new Set([r.applicationId]),
    });
  }
  return [...groups.values()]
    .map(({ apps, ...g }) => ({ ...g, blocking: apps.size }))
    .sort((a, b) => b.blocking - a.blocking);
}

/**
 * Saves the user's answer to the Answer Bank and clears it from every
 * pending row with the same question. Returns the applications that no longer
 * have any pending question (ready to be re-queued by the caller).
 */
export function answerPendingQuestion(db: Db, input: { normalizedQuestion: string; label: string; text: string; canonicalKey?: string | null }): number[] {
  upsertAnswer(db, { question: input.label, answer: { text: input.text }, canonicalKey: input.canonicalKey ?? null });
  const affected = db
    .selectDistinct({ id: applicationAnswers.applicationId })
    .from(applicationAnswers)
    .where(and(eq(applicationAnswers.pending, true), eq(applicationAnswers.normalizedQuestion, input.normalizedQuestion)))
    .all()
    .map((r) => r.id);
  if (!affected.length) return [];
  db.update(applicationAnswers)
    .set({ pending: false, source: "user", reason: "You answered this in Needs input", answerDisplay: input.text, updatedAt: nowSql })
    .where(and(eq(applicationAnswers.pending, true), eq(applicationAnswers.normalizedQuestion, input.normalizedQuestion)))
    .run();
  const stillBlocked = new Set(
    db
      .select({ id: applicationAnswers.applicationId })
      .from(applicationAnswers)
      .where(and(eq(applicationAnswers.pending, true), inArray(applicationAnswers.applicationId, affected)))
      .all()
      .map((r) => r.id),
  );
  return affected.filter((id) => !stillBlocked.has(id));
}

export function pendingCount(db: Db): number {
  return (
    db
      .select({ n: count() })
      .from(applicationAnswers)
      .innerJoin(applications, eq(applications.id, applicationAnswers.applicationId))
      .where(and(eq(applicationAnswers.pending, true), eq(applications.status, "needs_input")))
      .get()?.n ?? 0
  );
}

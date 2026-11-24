import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeQuestion } from "../resolver/normalize.ts";
import type { Db } from "./index.ts";
import { answerBank } from "./schema.ts";

/** A saved answer. `text` is what gets typed or matched against options. */
export const AnswerBankAnswerSchema = z.object({ text: z.string().min(1, "Answer can’t be empty") });
export type AnswerBankAnswer = z.infer<typeof AnswerBankAnswerSchema>;

export type AnswerBankEntry = typeof answerBank.$inferSelect & { answer: AnswerBankAnswer };

export function listAnswers(db: Db): AnswerBankEntry[] {
  return db.select().from(answerBank).orderBy(desc(answerBank.updatedAt)).all() as AnswerBankEntry[];
}

export function findAnswer(db: Db, question: string): AnswerBankEntry | null {
  const n = normalizeQuestion(question);
  return (db.select().from(answerBank).where(eq(answerBank.normalizedQuestion, n)).get() as AnswerBankEntry | undefined) ?? null;
}

export function upsertAnswer(db: Db, input: { question: string; answer: AnswerBankAnswer; canonicalKey?: string | null }): AnswerBankEntry {
  const answer = AnswerBankAnswerSchema.parse(input.answer);
  const normalizedQuestion = normalizeQuestion(input.question);
  if (!normalizedQuestion) throw new Error("Question can’t be empty");
  return db
    .insert(answerBank)
    .values({ normalizedQuestion, questionText: input.question.trim(), answer, canonicalKey: input.canonicalKey ?? null })
    .onConflictDoUpdate({
      target: answerBank.normalizedQuestion,
      set: { answer, questionText: input.question.trim(), updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` },
    })
    .returning()
    .get() as AnswerBankEntry;
}

export function updateAnswer(db: Db, id: number, input: { question: string; answer: AnswerBankAnswer }) {
  const answer = AnswerBankAnswerSchema.parse(input.answer);
  const normalizedQuestion = normalizeQuestion(input.question);
  if (!normalizedQuestion) throw new Error("Question can’t be empty");
  db.update(answerBank)
    .set({ normalizedQuestion, questionText: input.question.trim(), answer, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` })
    .where(eq(answerBank.id, id))
    .run();
}

export function deleteAnswer(db: Db, id: number) {
  db.delete(answerBank).where(eq(answerBank.id, id)).run();
}

export function markAnswerUsed(db: Db, id: number) {
  db.update(answerBank).set({ timesUsed: sql`${answerBank.timesUsed} + 1` }).where(eq(answerBank.id, id)).run();
}

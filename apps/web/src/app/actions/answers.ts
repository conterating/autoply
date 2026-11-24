"use server";

import { deleteAnswer, updateAnswer, upsertAnswer } from "@autoply/core/db";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { db } from "@/lib/db";

export type AnswerResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): AnswerResult {
  if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid answer" };
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

export async function addAnswer(question: string, text: string): Promise<AnswerResult> {
  try {
    upsertAnswer(db(), { question, answer: { text: text.trim() } });
    revalidatePath("/answers");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function editAnswer(id: number, question: string, text: string): Promise<AnswerResult> {
  try {
    updateAnswer(db(), id, { question, answer: { text: text.trim() } });
    revalidatePath("/answers");
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && /UNIQUE/.test(e.message)) return { ok: false, error: "Another saved answer already uses that question." };
    return fail(e);
  }
}

export async function removeAnswer(id: number): Promise<void> {
  deleteAnswer(db(), id);
  revalidatePath("/answers");
}

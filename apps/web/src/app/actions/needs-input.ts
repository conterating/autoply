"use server";

import { answerPendingQuestion } from "@autoply/core/db";
import { revalidatePath } from "next/cache";
import { requeueApplications } from "@/lib/applications";
import { db } from "@/lib/db";

export type AnswerQuestionResult = { ok: true; unblocked: number } | { ok: false; error: string };

export async function answerQuestion(input: { normalizedQuestion: string; label: string; text: string; canonicalKey: string | null }): Promise<AnswerQuestionResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Type or choose an answer first." };
  const d = db();
  const ready = answerPendingQuestion(d, { ...input, text });
  requeueApplications(d, ready, "Your Needs input answers were saved");
  revalidatePath("/", "layout");
  return { ok: true, unblocked: ready.length };
}

"use server";

import {
  applyStep,
  completeOnboarding,
  StepIdSchema,
  StepValidationError,
  type OnboardingStepId,
  type StepPatch,
} from "@autoply/core";
import { getProfile, getSettings, saveProfile } from "@autoply/core/db";
import { deleteDocument, setDefaultDocument, storeDocument, type DocumentKind } from "@autoply/core/documents";
import { createLlm, llmAvailable, LlmRefusalError } from "@autoply/core/llm";
import { heuristicParse, mergeParsedIntoProfile, parseResume } from "@autoply/core/resume";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

export type ActionResult = { ok: true } | { ok: false; error?: string; issues?: { path: string; message: string }[] };

export async function saveStep(step: OnboardingStepId, patch: StepPatch, advance: boolean): Promise<ActionResult> {
  const d = db();
  try {
    const next = applyStep(getProfile(d), StepIdSchema.parse(step), patch, { advance });
    saveProfile(d, next);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof StepValidationError) return { ok: false, issues: e.issues };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function goToStep(step: OnboardingStepId): Promise<void> {
  const d = db();
  const p = getProfile(d);
  p.onboarding.currentStep = StepIdSchema.parse(step);
  saveProfile(d, p);
}

export async function finishOnboarding(): Promise<ActionResult> {
  const d = db();
  try {
    saveProfile(d, completeOnboarding(getProfile(d)));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof StepValidationError) return { ok: false, issues: e.issues };
    throw e;
  }
}

export type UploadResult =
  | { ok: true; parsedWith: "claude" | "patterns"; notice?: string; added: { jobs: number; schools: number; skills: number } }
  | { ok: false; error: string };

const KINDS = ["resume", "transcript", "writing_sample", "cover_letter_example"] as const;

/**
 * Stores an uploaded document. For resumes, parses it (Claude when a key is
 * configured, pattern matching otherwise) and merges the result into the
 * profile as unconfirmed suggestions.
 */
export async function uploadDocument(form: FormData): Promise<UploadResult> {
  const file = form.get("file");
  const kind = (form.get("kind") as DocumentKind | null) ?? "resume";
  const fromOnboarding = form.get("onboarding") === "1";
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file to upload." };
  if (!KINDS.includes(kind)) return { ok: false, error: "Unknown document type." };

  const d = db();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await storeDocument(d, { kind, filename: file.name, bytes, makeDefault: kind === "resume" && fromOnboarding ? true : undefined });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (kind !== "resume") {
    revalidatePath("/profile");
    return { ok: true, parsedWith: "patterns", added: { jobs: 0, schools: 0, skills: 0 } };
  }

  let parsedWith: "claude" | "patterns" = "patterns";
  let notice: string | undefined;
  let parsed;
  if (await llmAvailable()) {
    try {
      const llm = await createLlm(getSettings(d));
      parsed = await parseResume(llm, { sha256: doc.sha256, mimeType: doc.mimeType, bytes, text: doc.extractedText ?? "" });
      parsedWith = "claude";
    } catch (e) {
      notice =
        e instanceof LlmRefusalError
          ? "Claude declined to read this resume, so only contact details were filled in."
          : `Couldn't reach Claude (${e instanceof Error ? e.message : String(e)}), so only contact details were filled in.`;
    }
  } else {
    notice = "No Claude API key yet, so only contact details and links were filled in. Add the rest below, or add a key in Settings and upload again.";
  }
  parsed ??= heuristicParse(doc.extractedText ?? "");

  const before = getProfile(d);
  let next = mergeParsedIntoProfile(before, parsed);
  if (fromOnboarding) {
    next = applyStep(next, "resume", {}, { advance: true });
  }
  saveProfile(d, next);
  revalidatePath("/", "layout");
  return {
    ok: true,
    parsedWith,
    notice,
    added: {
      jobs: next.experience.length - before.experience.length,
      schools: next.education.length - before.education.length,
      skills: (next.skills.value?.length ?? 0) - (before.skills.value?.length ?? 0),
    },
  };
}

/** Lets the user continue onboarding without a resume (everything entered by hand). */
export async function skipResume(): Promise<void> {
  const d = db();
  saveProfile(d, applyStep(getProfile(d), "resume", {}, { advance: true }));
  revalidatePath("/onboarding");
}

export async function makeDefaultDocument(id: number) {
  setDefaultDocument(db(), id);
  revalidatePath("/profile");
}

export async function removeDocument(id: number) {
  deleteDocument(db(), id);
  revalidatePath("/profile");
}

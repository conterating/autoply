import { z } from "zod";
import type { Llm } from "../llm/types.ts";
import type { Profile } from "../profile/schema.ts";
import { CATALOG, CATALOG_BY_KEY, isSensitiveKey, SENSITIVE_WORDS, type AnswerContext, type CatalogEntry, type Category, type ProfileAnswer } from "./catalog.ts";
import { normalizeQuestion } from "./normalize.ts";
import { matchBoolean, matchEnum, matchNumber, matchText, type OptionMatch } from "./options.ts";
import type { FieldAnswer, FormField } from "./types.ts";

export type AnswerSource = "profile" | "answer_bank" | "default" | "document" | "llm_draft" | "user";

export type Resolution = {
  fieldId: string;
  label: string;
  normalizedQuestion: string;
  canonicalKey: string | null;
  category: Category | null;
  sensitive: boolean;
  /**
   * answered: ready to fill. needs_input: the user must answer (Needs Input).
   * needs_draft: free text to be drafted from profile facts (cover letter, essays).
   * skipped: optional field Autoply leaves blank.
   */
  status: "answered" | "needs_input" | "needs_draft" | "skipped";
  answer?: FieldAnswer;
  display?: string;
  source?: AnswerSource;
  confidence: number;
  matchedBy: "pattern" | "llm" | "none";
  reason: string;
};

export type BankLookup = (normalizedQuestion: string) => { id: number; text: string } | null;

export type ResolveContext = AnswerContext & {
  profile: Profile;
  findBankAnswer: BankLookup;
  /** Optional: LLM for classifying questions the catalog doesn't match. */
  llm?: Llm | null;
  /** Below this confidence an answer goes to Needs Input. */
  threshold: number;
  documents: { resume?: { path: string; filename: string } | null; transcript?: { path: string; filename: string } | null };
};

// ------------------------------------------------------------------ matching

const PATTERN_CONFIDENCE = 0.95;

export function deterministicMatch(field: FormField): { entry: CatalogEntry; confidence: number } | null {
  const label = normalizeQuestion(field.label);
  if (!label) return null;
  for (const entry of CATALOG) {
    if (entry.types && !entry.types.includes(field.type)) continue;
    if (entry.not?.some((re) => re.test(label))) continue;
    if (entry.when && !entry.when(field)) continue;
    if (entry.patterns.some((re) => re.test(label))) return { entry, confidence: PATTERN_CONFIDENCE };
  }
  return null;
}

const CATALOG_KEYS = CATALOG.map((e) => e.key) as [string, ...string[]];

export const ClassificationSchema = z.object({
  key: z.enum([...CATALOG_KEYS, "novel"]).describe("Canonical key, or 'novel' if none applies"),
  confidence: z.number().describe("0 to 1"),
});

const CLASSIFY_SYSTEM = `You classify job-application form questions into canonical keys so they can be answered from the applicant's saved profile.

Return the single key whose meaning matches the question exactly, or "novel" when none does. A question only matches a key when answering it from that profile field would be truthful: "Are you able to obtain a clearance?" is not "security_clearance" (which means currently holding one). When unsure, prefer "novel" with low confidence. Confidence is your probability that the key is correct.

Keys: ${CATALOG_KEYS.join(", ")}`;

async function classify(llm: Llm, field: FormField): Promise<{ key: string | null; confidence: number } | null> {
  try {
    const r = await llm.structured({
      task: "classify_question",
      system: CLASSIFY_SYSTEM,
      content: JSON.stringify({ label: field.label, helpText: field.helpText ?? null, type: field.type, options: field.options?.map((o) => o.label) ?? null }),
      schema: ClassificationSchema,
      replayKey: { label: field.label, helpText: field.helpText ?? null, type: field.type, options: field.options?.map((o) => o.label) ?? null },
      maxTokens: 256,
    });
    return { key: r.key === "novel" ? null : r.key, confidence: Math.max(0, Math.min(1, r.confidence)) };
  } catch {
    // Unavailable, refused or no recording: treat as unclassified.
    return null;
  }
}

// ------------------------------------------------------------------ fitting answers to fields

function displayOf(a: FieldAnswer, field: FormField): string {
  switch (a.kind) {
    case "text":
      return a.value;
    case "boolean":
      return a.value ? "Checked" : "Unchecked";
    case "file":
      return a.filename;
    case "option":
      return a.values.map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(", ");
  }
}

function fromOptions(m: OptionMatch): { answer?: FieldAnswer; reason: string } {
  return m.ok ? { answer: { kind: "option", values: m.options.map((o) => o.value) }, reason: m.reason } : { reason: m.reason };
}

/** Fits a semantic profile value to the field's type and options. */
export function fitToField(value: string | number | boolean | string[], field: FormField, key: string, enumKey?: string): { answer?: FieldAnswer; reason: string } {
  const hasOptions = (field.options?.length ?? 0) > 0;

  if (field.type === "checkbox" && !hasOptions) {
    if (typeof value === "boolean") return { answer: { kind: "boolean", value }, reason: value ? "Checked" : "Left unchecked" };
    return { reason: "A single checkbox needs a yes/no answer" };
  }

  if (hasOptions) {
    if (enumKey && enumKey !== "degree_level") return fromOptions(matchEnum(enumKey, value as string | string[], field, field.label));
    if (typeof value === "boolean") return fromOptions(matchBoolean(value, field));
    if (typeof value === "number") return fromOptions(matchNumber(value, field));
    if (Array.isArray(value)) {
      const parts = value.map((v) => matchText(v, field));
      if (parts.every((p) => p.ok)) {
        return { answer: { kind: "option", values: parts.flatMap((p) => (p.ok ? p.options.map((o) => o.value) : [])) }, reason: "Matched each value" };
      }
      return { reason: "Not every value matches an option" };
    }
    return fromOptions(matchText(value, field, { allowOther: key === "how_did_you_hear" }));
  }

  if (typeof value === "boolean") return { answer: { kind: "text", value: value ? "Yes" : "No" }, reason: `Answered ${value ? "Yes" : "No"}` };
  if (Array.isArray(value)) return { answer: { kind: "text", value: value.join(", ") }, reason: "From profile" };
  return { answer: { kind: "text", value: String(value) }, reason: "From profile" };
}

// ------------------------------------------------------------------ pipeline

/** Free-text questions worth drafting (essays), as opposed to short factual unknowns. */
function isEssayQuestion(field: FormField, label: string) {
  if (field.type === "textarea") return true;
  if (field.type !== "text") return false;
  return /^(why|what|how|describe|tell|explain|share|please (describe|explain|share|tell))\b/.test(label) && label.split(" ").length >= 5;
}

export async function resolveField(field: FormField, ctx: ResolveContext): Promise<Resolution> {
  const normalizedQuestion = normalizeQuestion(field.label);
  const base = { fieldId: field.id, label: field.label, normalizedQuestion };

  let entry: CatalogEntry | null = null;
  let confidence = 0;
  let matchedBy: Resolution["matchedBy"] = "none";

  const det = deterministicMatch(field);
  if (det) {
    entry = det.entry;
    confidence = det.confidence;
    matchedBy = "pattern";
  } else if (ctx.llm) {
    const c = await classify(ctx.llm, field);
    if (c?.key) {
      entry = CATALOG_BY_KEY.get(c.key) ?? null;
      confidence = c.confidence;
      matchedBy = "llm";
    }
  }

  const sensitive = isSensitiveKey(entry?.key) || SENSITIVE_WORDS.test(normalizedQuestion);
  const common = { ...base, canonicalKey: entry?.key ?? null, category: entry?.category ?? null, sensitive, confidence, matchedBy };

  const fromBank = (why: string): Resolution | null => {
    const hit = ctx.findBankAnswer(normalizedQuestion);
    if (!hit) return null;
    const fitted = fitToField(hit.text, field, entry?.key ?? "", undefined);
    if (!fitted.answer) return null;
    return { ...common, status: "answered", answer: fitted.answer, display: displayOf(fitted.answer, field), source: "answer_bank", confidence: 1, reason: `Your saved answer (${why})` };
  };

  const needsInput = (reason: string): Resolution =>
    fromBank(reason) ?? (field.required || sensitive ? { ...common, status: "needs_input", reason } : { ...common, status: "skipped", reason: `Optional; ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` });

  if (entry && confidence >= ctx.threshold) {
    const pa: ProfileAnswer = entry.answer(ctx.profile, field, ctx, normalizedQuestion);
    switch (pa.kind) {
      case "value": {
        const fitted = fitToField(pa.value, field, entry.key, pa.enumKey);
        if (fitted.answer) {
          return { ...common, status: "answered", answer: fitted.answer, display: displayOf(fitted.answer, field), source: "profile", reason: fitted.reason };
        }
        return needsInput(fitted.reason);
      }
      case "file": {
        const doc = ctx.documents[pa.document];
        if (!doc) return needsInput(pa.document === "resume" ? "No resume uploaded" : "No transcript uploaded");
        const answer: FieldAnswer = { kind: "file", path: doc.path, filename: doc.filename };
        return { ...common, status: "answered", answer, display: doc.filename, source: "document", reason: `Attached your ${pa.document}` };
      }
      case "generate":
        return { ...common, status: "needs_draft", reason: "Written for this job from your profile" };
      case "missing":
        return needsInput(pa.reason);
    }
  }

  if (entry && confidence < ctx.threshold) {
    return needsInput(`Not sure what this asks (looks like ${entry.key.replace(/_/g, " ")}, ${Math.round(confidence * 100)}% confident)`);
  }

  // No catalog key: a novel question.
  if (sensitive) return needsInput("Looks like a legal or personal question; Autoply never guesses these");
  const bank = fromBank("matched this question");
  if (bank) return bank;
  if (isEssayQuestion(field, normalizedQuestion)) return { ...common, status: "needs_draft", reason: "Written for this job from your profile" };
  return needsInput("Not covered by your profile");
}

export async function resolveForm(fields: FormField[], ctx: ResolveContext): Promise<Resolution[]> {
  const out: Resolution[] = [];
  for (const f of fields) out.push(await resolveField(f, ctx));
  return out;
}

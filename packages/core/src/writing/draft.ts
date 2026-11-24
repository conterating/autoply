import type { Llm } from "../llm/types.ts";
import { buildFactSheet } from "./facts.ts";
import { writeAnswer, writeCoverLetter, type AnswerInput, type CoverLetterInput } from "./generate.ts";
import { verifyText, type UnsupportedClaim } from "./verify.ts";

export type DraftRequest = ({ kind: "cover_letter" } & CoverLetterInput) | ({ kind: "answer" } & Omit<AnswerInput, "avoid">);

export type DraftResult =
  | { status: "ok"; text: string; attempts: number }
  | { status: "needs_input"; reason: string; lastDraft: string; unsupported: UnsupportedClaim[] };

/**
 * Generate, verify, and (once) regenerate with the rejected claims banned.
 * A second failure, or an answer the facts cannot support, needs the user.
 */
export async function draftVerified(llm: Llm, req: DraftRequest): Promise<DraftResult> {
  const { known } = buildFactSheet(req.profile);
  const scan = { allowedEntities: [req.job.company, req.job.title] };

  const generate = async (avoid?: string[]): Promise<{ text: string; insufficient: boolean }> => {
    if (req.kind === "cover_letter") {
      const { kind: _kind, ...input } = req;
      return { text: await writeCoverLetter(llm, { ...input, avoid }), insufficient: false };
    }
    const { kind: _kind, ...input } = req;
    const r = await writeAnswer(llm, { ...input, avoid });
    return { text: r.answer, insufficient: r.insufficientFacts };
  };

  let avoid: string[] | undefined;
  let lastDraft = "";
  let unsupported: UnsupportedClaim[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { text, insufficient } = await generate(avoid);
    lastDraft = text;
    if (insufficient) {
      return { status: "needs_input", reason: "Your profile doesn't have enough facts to answer this question honestly.", lastDraft: text, unsupported: [] };
    }
    if (text === "") {
      return { status: "needs_input", reason: "The model returned an empty draft.", lastDraft: text, unsupported: [] };
    }
    const result = await verifyText(llm, text, known, scan);
    unsupported = result.unsupported;
    if (unsupported.length === 0) return { status: "ok", text, attempts: attempt };
    avoid = unsupported.map((u) => `${u.claim.text.trim()} (${u.reason})`);
  }
  return {
    status: "needs_input",
    reason: `The draft kept making claims your profile doesn't support: ${unsupported.map((u) => u.claim.value).join(", ")}`,
    lastDraft,
    unsupported,
  };
}

"use client";

import type { PendingQuestion } from "@autoply/core/db";
import { ArrowRight, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { answerQuestion } from "@/app/actions/needs-input";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/**
 * One question at a time. Choice questions answer with number keys; text
 * questions submit with ⌘/Ctrl+Enter. S skips to the next question.
 */
export function NeedsInputQueue({ questions, blockedHint }: { questions: PendingQuestion[]; blockedHint: number }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const q = questions[Math.min(index, questions.length - 1)]!;
  const options = q.options ?? [];

  function submit(answer: string) {
    setError(null);
    start(async () => {
      const r = await answerQuestion({ normalizedQuestion: q.normalizedQuestion, label: q.label, text: answer, canonicalKey: q.canonicalKey });
      if (!r.ok) return setError(r.error);
      setText("");
      setFlash(r.unblocked > 0 ? `Saved. ${r.unblocked} ${r.unblocked === 1 ? "application is" : "applications are"} back in the queue.` : "Saved to your Answer bank.");
      router.refresh();
    });
  }

  useEffect(() => {
    textRef.current?.focus();
  }, [q.normalizedQuestion]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (!typing && options.length && /^[1-9]$/.test(e.key)) {
        const o = options[Number(e.key) - 1];
        if (o) {
          e.preventDefault();
          submit(o.label);
        }
      } else if (!typing && e.key === "s" && questions.length > 1) {
        setIndex((i) => (i + 1) % questions.length);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-xs text-ink-3">
        <span className="font-mono tabular">
          {Math.min(index, questions.length - 1) + 1} / {questions.length}
        </span>
        <span aria-hidden>·</span>
        <span>
          {blockedHint} {blockedHint === 1 ? "application" : "applications"} waiting
        </span>
        <span role="status" aria-live="polite" className="ml-auto text-ok">
          {flash}
        </span>
      </div>

      <article className="rounded-lg border border-line bg-surface" aria-labelledby="question-label">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-3 text-xs">
          <span className="text-ink-3">Asked by</span>
          <a href={q.example.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-ink hover:underline">
            {q.example.company} · {q.example.title}
            <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">(opens the posting)</span>
          </a>
          <span className="ml-auto rounded bg-warn-soft px-1.5 py-px font-medium text-warn">
            Unblocks {q.blocking} {q.blocking === 1 ? "application" : "applications"}
          </span>
        </header>

        <div className="flex flex-col gap-4 px-5 py-5">
          <div>
            <h2 id="question-label" className="text-base font-medium text-ink">
              {q.label}
            </h2>
            {q.helpText && <p className="mt-1 text-[13px] text-ink-2">{q.helpText}</p>}
            {q.reason && <p className="mt-2 text-xs text-ink-3">Why you’re seeing this: {q.reason}</p>}
          </div>

          {options.length > 0 ? (
            <div role="group" aria-label="Answers" className="flex flex-col gap-1.5">
              {options.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={pending}
                  onClick={() => submit(o.label)}
                  className={cn(
                    "flex items-center gap-3 rounded-md border border-line-strong bg-surface px-3 py-2 text-left text-[13px] text-ink hover:border-carbon hover:bg-carbon-soft",
                    "disabled:opacity-60",
                  )}
                >
                  {i < 9 && <Kbd>{i + 1}</Kbd>}
                  {o.label}
                </button>
              ))}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(text);
              }}
              className="flex flex-col gap-3"
            >
              <label htmlFor="answer" className="sr-only">
                Your answer
              </label>
              <Textarea
                id="answer"
                ref={textRef}
                rows={q.fieldType === "textarea" ? 5 : 2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submit(text);
                  }
                }}
                aria-invalid={error ? true : undefined}
              />
              <div className="flex items-center gap-3">
                <Button type="submit" variant="primary" disabled={pending || !text.trim()}>
                  Save answer <ArrowRight aria-hidden />
                </Button>
                <span className="text-2xs text-ink-3">
                  <Kbd>⌘</Kbd> <Kbd>Enter</Kbd> to save
                </span>
              </div>
            </form>
          )}
          {error && <p className="text-xs font-medium text-bad">{error}</p>}
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-5 py-2.5 text-2xs text-ink-3">
          Saved to your Answer bank and reused whenever this question comes up.
          {questions.length > 1 && (
            <button type="button" onClick={() => setIndex((i) => (i + 1) % questions.length)} className="ml-auto inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
              Skip for now <Kbd>S</Kbd>
            </button>
          )}
        </footer>
      </article>
    </div>
  );
}

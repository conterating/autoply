"use client";

import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { addAnswer, editAnswer, removeAnswer } from "@/app/actions/answers";
import { EmptyState } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { formatRelative } from "@/lib/format";

type Row = { id: number; question: string; text: string; timesUsed: number; updatedAt: string };

function AnswerForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { question: string; text: string };
  submitLabel: string;
  onSubmit: (q: string, t: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const [q, setQ] = useState(initial.question);
  const [t, setT] = useState(initial.text);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await onSubmit(q, t);
          if (r.ok) onCancel();
          else setError(r.error ?? "Couldn’t save");
        });
      }}
    >
      <Field label="Question" hint="Matched regardless of capitalization and punctuation.">
        {(p) => <Input {...p} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
      </Field>
      <Field label="Answer" error={error ?? undefined}>
        {(p) => <Textarea {...p} rows={3} value={t} onChange={(e) => setT(e.target.value)} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending || !q.trim() || !t.trim()}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AnswerBankEditor({ answers }: { answers: Row[] }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [pending, start] = useTransition();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? answers.filter((a) => a.question.toLowerCase().includes(q) || a.text.toLowerCase().includes(q)) : answers;
  }, [answers, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-ink-3" aria-hidden />
          <Input aria-label="Search saved answers" placeholder="Search questions and answers" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button variant="secondary" onClick={() => setEditing("new")} disabled={editing === "new"}>
          <Plus aria-hidden /> Add an answer
        </Button>
      </div>

      {editing === "new" && (
        <div className="rounded-lg border border-line bg-surface p-4">
          <AnswerForm initial={{ question: "", text: "" }} submitLabel="Save answer" onSubmit={addAnswer} onCancel={() => setEditing(null)} />
        </div>
      )}

      {answers.length === 0 && editing !== "new" ? (
        <EmptyState title="No saved answers yet">
          When an application asks something your profile doesn’t cover, the question waits in Needs input. Your answer is saved here and reused
          every time that question comes up again. You can also add answers ahead of time.
        </EmptyState>
      ) : filtered.length === 0 && answers.length > 0 ? (
        <p className="text-[13px] text-ink-3">No saved answers match “{query}”.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {filtered.map((a) => (
            <li key={a.id} className="px-4 py-3">
              {editing === a.id ? (
                <AnswerForm initial={a} submitLabel="Save changes" onSubmit={(q, t) => editAnswer(a.id, q, t)} onCancel={() => setEditing(null)} />
              ) : (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{a.question}</p>
                    <p className="mt-0.5 text-[13px] whitespace-pre-line text-ink-2">{a.text}</p>
                    <p className="mt-1 text-2xs text-ink-3">
                      Used {a.timesUsed} {a.timesUsed === 1 ? "time" : "times"} · updated {formatRelative(a.updatedAt)}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a.id)} aria-label={`Edit answer to ${a.question}`}>
                    <Pencil aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => removeAnswer(a.id))} aria-label={`Delete answer to ${a.question}`}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

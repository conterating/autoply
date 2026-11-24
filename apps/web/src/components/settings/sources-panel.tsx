"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addSource, removeSource, saveCommunityLists, setSourceEnabled } from "@/app/actions/settings";
import { EmptyState } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatRelative } from "@/lib/format";
import { SaveRow } from "./save-row";

export type SourceRow = { id: number; ats: string; boardToken: string; companyName: string; enabled: boolean; lastPolledAt: string | null; lastError: string | null };

export function SourcesPanel({ sources }: { sources: SourceRow[] }) {
  const router = useRouter();
  const [ats, setAts] = useState("greenhouse");
  const [token, setToken] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      after?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {sources.length === 0 ? (
        <EmptyState title="No company boards yet">Add a company’s Greenhouse, Lever or Ashby board below and the worker will start finding its jobs.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[40rem] border-collapse text-left text-[13px]">
            <caption className="sr-only">Company job boards</caption>
            <thead>
              <tr className="border-b border-line text-2xs text-ink-3">
                <th scope="col" className="px-3 py-2 font-medium">Company</th>
                <th scope="col" className="px-3 py-2 font-medium">Source</th>
                <th scope="col" className="px-3 py-2 font-medium">Last polled</th>
                <th scope="col" className="px-3 py-2 font-medium">Last error</th>
                <th scope="col" className="px-3 py-2 font-medium">Enabled</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 font-medium text-ink">{s.companyName}</td>
                  <td className="px-3 py-2 text-ink-2">
                    {s.ats} <span className="font-mono text-xs text-ink-3">{s.boardToken}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-3 tabular">{s.lastPolledAt ? formatRelative(s.lastPolledAt) : "Never"}</td>
                  <td className="max-w-56 truncate px-3 py-2 text-xs text-bad" title={s.lastError ?? undefined}>{s.lastError ?? <span className="text-ink-3">None</span>}</td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Poll ${s.companyName}`}
                      checked={s.enabled}
                      disabled={pending}
                      onChange={(e) => run(() => setSourceEnabled(s.id, e.target.checked))}
                      className="size-3.5 accent-[var(--carbon)]"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button type="button" variant="ghost" size="sm" disabled={pending} aria-label={`Remove ${s.companyName}`} onClick={() => run(() => removeSource(s.id))}>
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        className="flex flex-wrap items-start gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addSource({ ats, boardToken: token, companyName: company }), () => {
            setToken("");
            setCompany("");
          });
        }}
      >
        <Field label="Job board" className="w-36">
          {(p) => (
            <Select {...p} value={ats} onChange={(e) => setAts(e.target.value)}>
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
            </Select>
          )}
        </Field>
        <Field label="Board token" hint="Letters, numbers, - and _" className="w-48">
          {(p) => <Input {...p} value={token} onChange={(e) => setToken(e.target.value)} className="font-mono" spellCheck={false} />}
        </Field>
        <Field label="Company name" className="w-56">
          {(p) => <Input {...p} value={company} onChange={(e) => setCompany(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" disabled={pending || !token.trim() || !company.trim()} className="mt-[22px]">
          <Plus aria-hidden /> Add board
        </Button>
      </form>
      <p role="alert" className="text-xs font-medium text-bad empty:hidden">{error}</p>
    </div>
  );
}

export function CommunityLists({ initial }: { initial: string[] }) {
  const router = useRouter();
  const [text, setText] = useState(initial.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await saveCommunityLists(text.split("\n"));
          if (!r.ok) {
            setSavedAt(null);
            return setError(r.error ?? r.issues?.[0]?.message ?? "Couldn’t save.");
          }
          setSavedAt(Date.now());
          router.refresh();
        });
      }}
    >
      <Field label="Community job-list URLs" hint="One address per line. Autoply reads company boards from these lists.">
        {(p) => <Textarea {...p} rows={4} value={text} onChange={(e) => setText(e.target.value)} className="font-mono" spellCheck={false} placeholder="https://example.com/jobs.json" />}
      </Field>
      <SaveRow pending={pending} error={error} savedAt={savedAt} label="Save lists" />
    </form>
  );
}

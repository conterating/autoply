"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { approveApplications } from "@/app/actions/applications";
import { StatusPill } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import type { PipelineRow } from "@/lib/pipeline";

export const DRY_RUN_EXPLANATION = "Dry run is on, so nothing is sent. Turn it off in Settings to send applications.";

function canSelect(r: PipelineRow) {
  return r.status === "ready" && r.pendingAnswers === 0;
}

export function PipelineTable({ rows, dryRun }: { rows: PipelineRow[]; dryRun: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const focused = useRef(-1);

  const selectable = rows.filter(canSelect);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function approve() {
    setError(null);
    setFlash(null);
    start(async () => {
      const r = await approveApplications([...selected]);
      if (!r.ok) return setError(r.error);
      setSelected(new Set());
      setFlash(`Approved ${r.approved} ${r.approved === 1 ? "application" : "applications"}. The worker will send them.`);
      router.refresh();
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(t.tagName))) return;
      if (e.key === "j" || e.key === "k") {
        const next = Math.max(0, Math.min(rows.length - 1, focused.current + (e.key === "j" ? 1 : -1)));
        focused.current = next;
        rowRefs.current[next]?.focus();
        e.preventDefault();
        return;
      }
      const i = rowRefs.current.findIndex((el) => el === document.activeElement);
      if (i < 0) return;
      const row = rows[i]!;
      if (e.key === "x" && canSelect(row)) {
        toggle(row.id);
        e.preventDefault();
      } else if (e.key === "Enter") {
        router.push(`/applications/${row.id}`);
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <div role="status" aria-live="polite" className="mb-2 min-h-4 text-xs text-ok">
        {flash}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[56rem] border-collapse text-left text-[13px]">
          <caption className="sr-only">Applications, newest activity first</caption>
          <thead>
            <tr className="border-b border-line text-2xs font-medium text-ink-3">
              <th scope="col" className="w-9 py-2 pl-3">
                <input
                  type="checkbox"
                  aria-label="Select all ready applications on this page"
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))}
                  className="size-3.5 accent-[var(--carbon)]"
                />
              </th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
              <th scope="col" className="px-3 py-2 font-medium">Company</th>
              <th scope="col" className="px-3 py-2 font-medium">Title</th>
              <th scope="col" className="px-3 py-2 font-medium">Location</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Match</th>
              <th scope="col" className="px-3 py-2 font-medium">Source</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                tabIndex={-1}
                onFocus={() => (focused.current = i)}
                className={cn(
                  "border-b border-line last:border-b-0 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2",
                  selected.has(r.id) && "bg-carbon-soft hover:bg-carbon-soft",
                )}
              >
                <td className="py-2 pl-3">
                  {canSelect(r) && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.company}, ${r.title}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="size-3.5 accent-[var(--carbon)]"
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={r.status} />
                </td>
                <td className="max-w-44 truncate px-3 py-2 font-medium text-ink">
                  <Link href={`/applications/${r.id}`} className="hover:underline">
                    {r.company}
                  </Link>
                </td>
                <td className="max-w-72 truncate px-3 py-2 text-ink-2" title={r.title}>
                  {r.title}
                </td>
                <td className="max-w-40 truncate px-3 py-2 text-ink-3" title={r.location}>
                  {r.location || "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular" title={r.matchReason ?? undefined}>
                  {r.matchScore == null ? <span className="text-ink-3">—</span> : Math.round(r.matchScore)}
                </td>
                <td className="px-3 py-2 text-ink-3">{r.ats}</td>
                <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap text-ink-3 tabular">
                  <time dateTime={r.updatedAt} suppressHydrationWarning>
                    {formatRelative(r.updatedAt)}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-3">
        <span>
          <Kbd>j</Kbd> <Kbd>k</Kbd> move
        </span>
        <span>
          <Kbd>x</Kbd> select
        </span>
        <span>
          <Kbd>Enter</Kbd> open
        </span>
      </p>

      {selected.size > 0 && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-4 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 px-6 py-3 backdrop-blur">
          <span className="font-mono text-xs tabular text-ink-2">{selected.size} selected</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
          <div role="alert" className="min-w-0 flex-1 text-xs">
            {error ? <span className="font-medium text-bad">{error}</span> : dryRun ? <span id="dry-run-note" className="text-ink-3">{DRY_RUN_EXPLANATION}</span> : null}
          </div>
          <Button type="button" variant="primary" disabled={pending || dryRun} aria-describedby={dryRun ? "dry-run-note" : undefined} onClick={approve}>
            <Send aria-hidden /> {pending ? "Approving…" : "Approve and send"}
          </Button>
        </div>
      )}
    </>
  );
}

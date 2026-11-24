"use client";

import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FromResume } from "@/components/ui/field";
import { cn } from "@/lib/cn";

type Item = { id: string; confirmedByUser?: boolean };

/** Collapsible list of entries (jobs, schools, ...) with add and remove. */
export function ListEditor<T extends Item>({
  items,
  onChange,
  title,
  subtitle,
  render,
  create,
  addLabel,
  empty,
  hasError,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  title: (item: T) => string;
  subtitle?: (item: T) => string;
  render: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
  create: () => T;
  addLabel: string;
  empty: string;
  hasError?: (index: number) => boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(items.filter((i) => !i.confirmedByUser).map((i) => i.id)));
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && <p className="rounded-md border border-dashed border-line-strong px-4 py-3 text-[13px] text-ink-3">{empty}</p>}
      {items.map((item, index) => {
        const isOpen = open.has(item.id) || hasError?.(index);
        const panelId = `entry-${item.id}`;
        return (
          <div key={item.id} className={cn("rounded-lg border bg-surface", hasError?.(index) ? "border-bad" : "border-line")}>
            <div className="flex items-center gap-2 pr-2">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
              >
                <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-ink-3 transition-transform", !isOpen && "-rotate-90")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{title(item) || "Untitled"}</span>
                  {subtitle && <span className="block truncate text-xs text-ink-3">{subtitle(item)}</span>}
                </span>
                {item.confirmedByUser === false && <FromResume />}
              </button>
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${title(item) || "entry"}`} onClick={() => onChange(items.filter((i) => i.id !== item.id))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
            {isOpen && (
              <div id={panelId} className="border-t border-line px-4 py-4">
                {render(item, (patch) => onChange(items.map((i) => (i.id === item.id ? { ...i, ...patch } : i))), index)}
              </div>
            )}
          </div>
        );
      })}
      <div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            const n = create();
            onChange([...items, n]);
            setOpen((s) => new Set(s).add(n.id));
          }}
        >
          <Plus aria-hidden /> {addLabel}
        </Button>
      </div>
    </div>
  );
}

export function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function monthLabel(m: string | null) {
  if (!m) return "";
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

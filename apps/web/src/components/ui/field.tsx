"use client";

import { X } from "lucide-react";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-3 " +
  "hover:border-ink-3 focus:border-carbon focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 " +
  "aria-[invalid=true]:border-bad disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-8 pr-7", className)} {...props}>
      {children}
    </select>
  );
}

/** Marks a value that came from the resume parse and hasn't been confirmed yet. */
export function FromResume() {
  return (
    <span className="rounded border border-dashed border-carbon/50 px-1 text-2xs font-medium text-carbon" title="Filled in from your resume. Check it before saving.">
      From resume
    </span>
  );
}

/**
 * Label + control + hint + error, wired with ids for screen readers.
 * `children` receives the props to spread onto the control.
 */
export function Field({
  label,
  hint,
  error,
  required,
  suggested,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  suggested?: boolean;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean; required?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="flex items-center gap-2 text-xs font-medium text-ink-2">
        {label}
        {required && <span className="text-ink-3" aria-hidden>Required</span>}
        {suggested && <FromResume />}
      </label>
      {children({
        id,
        "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined,
        "aria-invalid": error ? true : undefined,
        required,
      })}
      {hint && !error && (
        <p id={hintId} className="text-2xs text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-2xs font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

/** Single choice from a few options, as a segmented row of radio buttons. */
export function Choice<T extends string | boolean>({
  legend,
  options,
  value,
  onChange,
  error,
  hint,
  required,
  name,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  name: string;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-1.5" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined}>
      <legend className="mb-1.5 flex items-center gap-2 text-xs font-medium text-ink-2">
        {legend}
        {required && <span className="text-ink-3">Required</span>}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={String(o.value)}
              className={cn(
                "flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-[13px] select-none",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]",
                checked ? "border-carbon bg-carbon-soft text-ink" : "border-line-strong bg-surface text-ink-2 hover:border-ink-3",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                checked={checked}
                onChange={() => onChange(o.value)}
              />
              <span
                aria-hidden
                className={cn("size-3 rounded-full border", checked ? "border-[4px] border-carbon" : "border-line-strong")}
              />
              {o.label}
            </label>
          );
        })}
      </div>
      {hint && !error && <p className="text-2xs text-ink-3">{hint}</p>}
      {error && (
        <p id={`${id}-err`} className="text-2xs font-medium text-bad">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Multiple choice as checkboxes. */
export function MultiChoice<T extends string>({
  legend,
  options,
  value,
  onChange,
  error,
  hint,
  exclusive,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  error?: string;
  hint?: ReactNode;
  /** Selecting this value clears the others (e.g. "decline"). */
  exclusive?: T;
}) {
  function toggle(v: T) {
    if (value.includes(v)) return onChange(value.filter((x) => x !== v));
    if (v === exclusive) return onChange([v]);
    return onChange([...value.filter((x) => x !== exclusive), v]);
  }
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium text-ink-2">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const checked = value.includes(o.value);
          return (
            <label
              key={o.value}
              className={cn(
                "flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-[13px] select-none",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]",
                checked ? "border-carbon bg-carbon-soft text-ink" : "border-line-strong bg-surface text-ink-2 hover:border-ink-3",
              )}
            >
              <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(o.value)} />
              <span aria-hidden className={cn("grid size-3 place-items-center rounded-[3px] border", checked ? "border-carbon bg-carbon" : "border-line-strong")}>
                {checked && <span className="block size-1.5 rounded-[1px] bg-carbon-ink" />}
              </span>
              {o.label}
            </label>
          );
        })}
      </div>
      {hint && !error && <p className="text-2xs text-ink-3">{hint}</p>}
      {error && <p className="text-2xs font-medium text-bad">{error}</p>}
    </fieldset>
  );
}

/** Free-form list of short strings (skills, titles, companies). Enter or comma adds. */
export function TagInput({
  value,
  onChange,
  placeholder,
  id,
  ...aria
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const [draft, setDraft] = useState("");
  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])]);
    setDraft("");
  }
  return (
    <div className={cn(control, "flex min-h-8 flex-wrap items-center gap-1 py-1")}>
      {value.map((t) => (
        <span key={t} className="inline-flex h-6 items-center gap-1 rounded bg-surface-2 pr-1 pl-2 text-xs text-ink">
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(value.filter((x) => x !== t))}
            className="grid size-4 place-items-center rounded text-ink-3 hover:bg-line hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        {...aria}
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => {
          if (e.target.value.endsWith(",")) commit(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        className="h-6 min-w-24 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3"
      />
    </div>
  );
}

export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 max-w-prose text-xs text-ink-3">{description}</p>}
      </div>
      {children}
    </section>
  );
}

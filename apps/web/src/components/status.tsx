import type { ApplicationStatus } from "@autoply/core";
import { cn } from "@/lib/cn";

const STATUS: Record<ApplicationStatus, { label: string; tone: "neutral" | "carbon" | "ok" | "warn" | "bad" | "user" }> = {
  discovered: { label: "Found", tone: "neutral" },
  matched: { label: "Matched", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
  queued: { label: "Queued", tone: "neutral" },
  filling: { label: "Filling", tone: "carbon" },
  needs_input: { label: "Needs input", tone: "warn" },
  needs_user: { label: "Needs you", tone: "user" },
  ready: { label: "Ready to send", tone: "carbon" },
  submitting: { label: "Sending", tone: "carbon" },
  submitted: { label: "Sent", tone: "ok" },
  confirmed: { label: "Confirmed", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

const TONES = {
  neutral: "text-ink-2 bg-surface-2",
  carbon: "text-carbon bg-carbon-soft",
  ok: "text-ok bg-ok-soft",
  warn: "text-warn bg-warn-soft",
  bad: "text-bad bg-bad-soft",
  user: "text-user bg-user-soft",
} as const;

export function statusLabel(s: ApplicationStatus) {
  return STATUS[s].label;
}

export function StatusPill({ status, className }: { status: ApplicationStatus; className?: string }) {
  const { label, tone } = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded px-1.5 text-2xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

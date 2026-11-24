"use client";

import { Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { setWorkerDesired } from "@/app/actions/worker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { WorkerView } from "@/lib/shell";

export function workerLabel(w: WorkerView) {
  if (!w.alive) return { text: "Worker stopped", tone: "off" as const };
  if (w.desired === "paused") return { text: "Paused", tone: "paused" as const };
  return { text: w.activity && w.activity !== "Paused" ? w.activity : "Running", tone: "on" as const };
}

export function WorkerDot({ worker }: { worker: WorkerView }) {
  const { text, tone } = workerLabel(worker);
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-ink-2" role="status">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          tone === "on" && "bg-ok shadow-[0_0_0_3px_var(--ok-soft)]",
          tone === "paused" && "bg-warn",
          tone === "off" && "border border-ink-3",
        )}
      />
      <span className="truncate">{text}</span>
    </span>
  );
}

export function WorkerToggle({ worker }: { worker: WorkerView }) {
  const [pending, start] = useTransition();
  const running = worker.desired === "running";
  return (
    <Button
      variant={running ? "secondary" : "primary"}
      disabled={pending}
      onClick={() => start(() => setWorkerDesired(running ? "paused" : "running"))}
    >
      {running ? <Pause aria-hidden /> : <Play aria-hidden />}
      {running ? "Pause applying" : "Start applying"}
    </Button>
  );
}

/** Re-fetches server data on an interval so counts and worker status stay live. */
export function LiveRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}

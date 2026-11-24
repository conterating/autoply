"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Error boundary for console pages: says what failed and how to recover. */
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div role="alert" className="rounded-lg border border-bad/40 bg-bad-soft px-5 py-4">
        <h1 className="text-sm font-semibold text-ink">This page couldn’t load</h1>
        <p className="mt-1 text-[13px] text-ink-2">
          {error.message || "Something went wrong reading your data."} Your data hasn’t changed. Try again, and if it keeps happening run{" "}
          <code className="rounded bg-surface px-1 font-mono text-xs">autoply doctor</code> in a terminal.
        </p>
        <Button className="mt-3" variant="secondary" size="sm" onClick={reset}>
          <RotateCcw aria-hidden /> Try again
        </Button>
      </div>
    </div>
  );
}

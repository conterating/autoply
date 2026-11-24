"use client";

import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { FormMode } from "./use-step-form";

export function FormFooter({
  mode,
  pending,
  error,
  savedAt,
  backHref,
}: {
  mode: FormMode;
  pending: boolean;
  error: string | null;
  savedAt: number | null;
  backHref?: string;
}) {
  return (
    <div className="sticky bottom-0 -mx-6 mt-8 flex items-center gap-3 border-t border-line bg-paper/95 px-6 py-3 backdrop-blur">
      {mode === "wizard" && backHref && (
        <Button asChild variant="ghost">
          <Link href={backHref}>
            <ArrowLeft aria-hidden /> Back
          </Link>
        </Button>
      )}
      <div role="status" aria-live="polite" className="min-w-0 flex-1 truncate text-xs">
        {error ? (
          <span className="font-medium text-bad">{error}</span>
        ) : savedAt && mode === "profile" ? (
          <span className="inline-flex items-center gap-1 text-ok">
            <Check className="size-3.5" aria-hidden /> Saved
          </span>
        ) : mode === "wizard" ? (
          <span className="text-ink-3">Saving confirms every answer on this page.</span>
        ) : null}
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        {mode === "wizard" ? (
          <>
            {pending ? "Saving…" : "Save and continue"} <ArrowRight aria-hidden />
          </>
        ) : pending ? (
          "Saving…"
        ) : (
          "Save changes"
        )}
      </Button>
    </div>
  );
}

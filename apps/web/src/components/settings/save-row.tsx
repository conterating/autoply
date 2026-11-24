import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SaveRow({ pending, error, savedAt, label = "Save changes" }: { pending: boolean; error: string | null; savedAt: number | null; label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
      <div role="status" aria-live="polite" className="min-w-0 truncate text-xs">
        {error ? (
          <span className="font-medium text-bad">{error}</span>
        ) : savedAt ? (
          <span className="inline-flex items-center gap-1 text-ok">
            <Check className="size-3.5" aria-hidden /> Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}

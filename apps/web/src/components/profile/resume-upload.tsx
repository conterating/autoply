"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { skipResume, uploadDocument, type UploadResult } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function ResumeUpload({ onboarding, next }: { onboarding: boolean; next?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<UploadResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);

  function upload(file: File) {
    setFilename(file.name);
    setResult(null);
    const form = new FormData();
    form.set("file", file);
    form.set("kind", "resume");
    if (onboarding) form.set("onboarding", "1");
    start(async () => {
      const r = await uploadDocument(form);
      setResult(r);
      if (r.ok && !onboarding) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) upload(f);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
          dragging ? "border-carbon bg-carbon-soft" : "border-line-strong bg-surface",
        )}
      >
        {pending ? <Loader2 className="size-6 animate-spin text-carbon" aria-hidden /> : <FileUp className="size-6 text-ink-3" aria-hidden />}
        <div>
          <p className="text-sm font-medium text-ink">{pending ? `Reading ${filename}…` : "Drop your resume here"}</p>
          <p className="mt-0.5 text-xs text-ink-3">PDF or Word (.docx), up to 10 MB</p>
        </div>
        <input
          ref={input}
          id="resume-file"
          aria-label="Resume file"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="secondary" disabled={pending} onClick={() => input.current?.click()}>
          Choose a file
        </Button>
      </div>

      <div role="status" aria-live="polite">
        {result && !result.ok && <p className="text-[13px] font-medium text-bad">{result.error}</p>}
        {result?.ok && (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <p className="text-[13px] text-ink">
              Read <span className="font-medium">{filename}</span>
              {result.parsedWith === "claude" ? " with Claude" : ""}: found {result.added.jobs} {result.added.jobs === 1 ? "job" : "jobs"},{" "}
              {result.added.schools} {result.added.schools === 1 ? "school" : "schools"} and {result.added.skills} skills.
            </p>
            {result.notice && <p className="text-xs text-warn">{result.notice}</p>}
            {onboarding && next && (
              <div>
                <Button variant="primary" onClick={() => router.push(next)}>
                  Check what was found
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {onboarding && !result?.ok && (
        <p className="text-xs text-ink-3">
          No resume handy?{" "}
          <button
            type="button"
            className="text-carbon underline underline-offset-2"
            onClick={() =>
              start(async () => {
                await skipResume();
                router.push(next ?? "/onboarding");
              })
            }
          >
            Enter everything by hand
          </button>
        </p>
      )}
    </div>
  );
}

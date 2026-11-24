"use client";

import { Download } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteAllData } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function DataPanel() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-2">
        <p className="max-w-prose text-[13px] text-ink-2">Download your profile, settings, saved answers, boards, jobs, applications and their answers and events as one JSON file. Your Claude API key is not included.</p>
        <Button asChild>
          <a href="/api/export" download>
            <Download aria-hidden /> Export everything
          </a>
        </Button>
      </div>
      <form
        className="flex max-w-md flex-col gap-3 rounded-lg border border-line p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await deleteAllData(text);
            if (r && !r.ok) setError(r.error ?? "Couldn’t delete your data.");
          });
        }}
      >
        <p className="text-[13px] text-ink-2">Deletes your profile, answers, jobs, applications, uploaded documents and screenshots from this computer. This can’t be undone.</p>
        <Field label="Type DELETE to confirm" error={error ?? undefined}>
          {(p) => <Input {...p} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" className="font-mono" />}
        </Field>
        <div>
          <Button type="submit" variant="danger" disabled={pending || text.trim() !== "DELETE"}>
            {pending ? "Deleting…" : "Delete all data"}
          </Button>
        </div>
      </form>
    </div>
  );
}

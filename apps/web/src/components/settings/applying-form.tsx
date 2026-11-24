"use client";

import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveApplyingSettings } from "@/app/actions/settings";
import { Choice, Field, Input } from "@/components/ui/field";
import { SaveRow } from "./save-row";

export type ApplyingValues = {
  mode: "review" | "autopilot";
  dryRun: boolean;
  dailyCap: number;
  pacing: { minSeconds: number; maxSeconds: number };
  matchThreshold: number;
  autopilotMatchThreshold: number;
  answerConfidenceThreshold: number;
};

export function ApplyingForm({ initial }: { initial: ApplyingValues }) {
  const router = useRouter();
  const [mode, setMode] = useState(initial.mode);
  const [dryRun, setDryRun] = useState(initial.dryRun);
  const [n, setN] = useState({
    dailyCap: String(initial.dailyCap),
    minSeconds: String(initial.pacing.minSeconds),
    maxSeconds: String(initial.pacing.maxSeconds),
    matchThreshold: String(initial.matchThreshold),
    autopilotMatchThreshold: String(initial.autopilotMatchThreshold),
    confidence: String(Math.round(initial.answerConfidenceThreshold * 100)),
  });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof n) => (e: React.ChangeEvent<HTMLInputElement>) => setN((s) => ({ ...s, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveApplyingSettings({
        mode,
        dryRun,
        dailyCap: Number(n.dailyCap),
        pacing: { minSeconds: Number(n.minSeconds), maxSeconds: Number(n.maxSeconds) },
        matchThreshold: Number(n.matchThreshold),
        autopilotMatchThreshold: Number(n.autopilotMatchThreshold),
        answerConfidenceThreshold: Number(n.confidence) / 100,
      });
      if (r.ok) {
        setIssues({});
        setSavedAt(Date.now());
        router.refresh();
      } else {
        setSavedAt(null);
        setIssues(Object.fromEntries((r.issues ?? []).map((i) => [i.path, i.message])));
        setError(r.error ?? "Couldn’t save.");
      }
    });
  }

  const num = (v: string) => (v.trim() === "" ? "Enter a number." : undefined);
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Choice
        legend="Mode"
        name="mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: "review", label: "Review" },
          { value: "autopilot", label: "Autopilot" },
        ]}
        hint={
          mode === "review"
            ? "Review: every application waits for your approval before it is sent."
            : "Autopilot only sends when every required answer was resolved above the confidence threshold, the match score clears the autopilot bar, and today’s limit has room. Otherwise it waits for review."
        }
      />

      <Choice
        legend="Dry run"
        name="dryRun"
        value={dryRun}
        onChange={setDryRun}
        options={[
          { value: true, label: "On: never click submit" },
          { value: false, label: "Off: send applications" },
        ]}
        hint="With dry run on, Autoply fills every form and takes screenshots but stops before the submit click."
      />
      {!dryRun && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Real applications will be submitted in your name. Check your profile and answers before you save this.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Daily limit" hint="Applications sent per day (1 to 500)." error={issues.dailyCap ?? num(n.dailyCap)}>
          {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={500} value={n.dailyCap} onChange={set("dailyCap")} className="font-mono tabular" />}
        </Field>
        <Field label="Shortest pause (seconds)" hint="Between applications." error={issues["pacing.minSeconds"] ?? num(n.minSeconds)}>
          {(p) => <Input {...p} type="number" inputMode="numeric" min={0} value={n.minSeconds} onChange={set("minSeconds")} className="font-mono tabular" />}
        </Field>
        <Field label="Longest pause (seconds)" hint="Must be at least the shortest." error={issues.pacing ?? issues["pacing.maxSeconds"] ?? num(n.maxSeconds)}>
          {(p) => <Input {...p} type="number" inputMode="numeric" min={0} value={n.maxSeconds} onChange={set("maxSeconds")} className="font-mono tabular" />}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Match threshold" hint="Postings scoring below this are skipped (0 to 100)." error={issues.matchThreshold ?? num(n.matchThreshold)}>
          {(p) => <Input {...p} type="number" inputMode="numeric" min={0} max={100} value={n.matchThreshold} onChange={set("matchThreshold")} className="font-mono tabular" />}
        </Field>
        <Field label="Autopilot match bar" hint="Autopilot sends only at or above this score (0 to 100)." error={issues.autopilotMatchThreshold ?? num(n.autopilotMatchThreshold)}>
          {(p) => <Input {...p} type="number" inputMode="numeric" min={0} max={100} value={n.autopilotMatchThreshold} onChange={set("autopilotMatchThreshold")} className="font-mono tabular" />}
        </Field>
        <Field label="Answer confidence threshold (%)" hint="Answers below this go to Needs input." error={issues.answerConfidenceThreshold ?? num(n.confidence)}>
          {(p) => <Input {...p} type="number" inputMode="numeric" min={0} max={100} value={n.confidence} onChange={set("confidence")} className="font-mono tabular" />}
        </Field>
      </div>

      <SaveRow pending={pending} error={error} savedAt={savedAt} />
    </form>
  );
}

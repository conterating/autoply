"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeApiKey, saveApiKey, saveModelSettings } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { SaveRow } from "./save-row";

export function ApiKeyForm({ masked, source }: { masked: string | null; source: "env" | "keychain" | null }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => ReturnType<typeof saveApiKey>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Couldn’t save.");
      setKey("");
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-ink-2" role="status">
        {source
          ? <>Key configured from {source === "env" ? "the ANTHROPIC_API_KEY environment variable" : "the OS keychain"}: <span className="font-mono">{masked}</span></>
          : "No key configured. Autoply needs one to read your resume and write answers."}
      </p>
      {source === "env" && (
        <p className="text-xs text-ink-3">The environment variable takes precedence over a key saved here. Unset it to use the keychain key.</p>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveApiKey(key));
        }}
      >
        <Field label="New Claude API key" hint="Saved to your OS keychain. Never stored in the database or shown again.">
          {(p) => <Input {...p} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" className="max-w-md font-mono" />}
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={pending || !key.trim()}>
            Save key to keychain
          </Button>
          {source === "keychain" && (
            <Button type="button" variant="danger" disabled={pending} onClick={() => run(() => removeApiKey())}>
              Remove saved key
            </Button>
          )}
          <div role="status" aria-live="polite" className="text-xs">
            {error ? <span className="font-medium text-bad">{error}</span> : savedAt ? <span className="text-ok">Saved</span> : null}
          </div>
        </div>
      </form>
    </div>
  );
}

export function ModelsForm({ initial, defaults }: { initial: { classify: string; write: string; parse: string }; defaults: { classify: string; write: string; parse: string } }) {
  const router = useRouter();
  const [m, setM] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const rows = [
    ["classify", "Classify", "Question types and match scoring. Fast and cheap."],
    ["write", "Write", "Cover letters and free-text answers."],
    ["parse", "Parse", "Reading your resume."],
  ] as const;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await saveModelSettings(m);
          if (!r.ok) {
            setSavedAt(null);
            return setError(r.issues?.[0]?.message ?? r.error ?? "Couldn’t save.");
          }
          setSavedAt(Date.now());
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {rows.map(([k, label, what]) => (
          <Field key={k} label={`${label} model`} hint={`${what} Default: ${defaults[k]}`}>
            {(p) => <Input {...p} value={m[k]} onChange={(e) => setM((s) => ({ ...s, [k]: e.target.value }))} className="font-mono" spellCheck={false} />}
          </Field>
        ))}
      </div>
      <SaveRow pending={pending} error={error} savedAt={savedAt} />
    </form>
  );
}

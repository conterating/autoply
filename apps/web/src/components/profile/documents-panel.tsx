"use client";

import { FileText, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { makeDefaultDocument, removeDocument, uploadDocument } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/field";
import { formatDateTime } from "@/lib/format";
import { ResumeUpload } from "./resume-upload";

type Doc = {
  id: number;
  kind: "resume" | "transcript" | "writing_sample" | "cover_letter_example";
  label: string;
  filename: string;
  sizeBytes: number;
  isDefault: boolean;
  createdAt: string;
};

const KIND_LABEL: Record<Doc["kind"], string> = {
  resume: "Resumes",
  transcript: "Transcripts",
  writing_sample: "Writing samples",
  cover_letter_example: "Cover letter examples",
};

function DocRow({ doc }: { doc: Doc }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <FileText className="size-4 shrink-0 text-ink-3" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">
          {doc.label}
          {doc.isDefault && <span className="ml-2 rounded bg-carbon-soft px-1.5 py-px text-2xs font-medium text-carbon">Default</span>}
        </p>
        <p className="truncate text-xs text-ink-3">
          {doc.filename} · {(doc.sizeBytes / 1024).toFixed(0)} KB · added {formatDateTime(doc.createdAt)}
        </p>
      </div>
      {!doc.isDefault && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => makeDefaultDocument(doc.id))}>
          <Star aria-hidden /> Make default
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={pending} aria-label={`Delete ${doc.label}`} onClick={() => start(() => removeDocument(doc.id))}>
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

function OtherUpload({ kind, label }: { kind: "transcript" | "writing_sample"; label: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx"
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const form = new FormData();
          form.set("file", f);
          form.set("kind", kind);
          start(async () => {
            const r = await uploadDocument(form);
            setError(r.ok ? null : r.error);
            router.refresh();
          });
          e.target.value = "";
        }}
      />
      <Button size="sm" disabled={pending} onClick={() => input.current?.click()}>
        {label}
      </Button>
      {error && <span className="text-2xs text-bad">{error}</span>}
    </span>
  );
}

export function DocumentsPanel({ documents }: { documents: Doc[] }) {
  const byKind = (k: Doc["kind"]) => documents.filter((d) => d.kind === k);
  return (
    <div className="flex flex-col gap-8">
      <Section title="Resumes" description="The default resume is attached to every application. Uploading a new one also suggests profile updates.">
        {byKind("resume").length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {byKind("resume").map((d) => (
              <DocRow key={d.id} doc={d} />
            ))}
          </ul>
        )}
        <ResumeUpload onboarding={false} />
      </Section>
      {(["transcript", "writing_sample"] as const).map((k) => (
        <Section key={k} title={KIND_LABEL[k]} description={k === "transcript" ? "Attached only where a form asks for a transcript." : "Attached only where a form asks for a writing sample."}>
          {byKind(k).length > 0 ? (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {byKind(k).map((d) => (
                <DocRow key={d.id} doc={d} />
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">None uploaded.</p>
          )}
          <div>
            <OtherUpload kind={k} label={k === "transcript" ? "Upload a transcript" : "Upload a writing sample"} />
          </div>
        </Section>
      ))}
    </div>
  );
}

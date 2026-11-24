import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationActions } from "@/components/application/application-actions";
import { CopyButton } from "@/components/application/copy-button";
import { PageHeader } from "@/components/shell/page-header";
import { StatusPill, statusLabel } from "@/components/status";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { getApplicationView } from "@/lib/applications-view";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@autoply/core/db";

export const dynamic = "force-dynamic";

const SOURCES: Record<string, string> = {
  profile: "From profile",
  answer_bank: "Saved answer",
  llm_draft: "Written for this job",
  user: "You answered",
  document: "Document",
  default: "Default",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = /^\d+$/.test(id) ? getApplicationView(db(), Number(id)) : null;
  return { title: v ? `${v.posting.company} · ${v.posting.title}` : "Application" };
}

function Shot({ title, name }: { title: string; name: string | null }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-xs font-medium text-ink-2">{title}</figcaption>
      {name ? (
        <a href={`/api/screenshots/${encodeURIComponent(name)}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/screenshots/${encodeURIComponent(name)}`} alt={`${title} screenshot of the application form`} className="max-h-96 w-full object-cover object-top" />
          <span className="sr-only">(opens full size)</span>
        </a>
      ) : (
        <div className="grid h-32 place-items-center rounded-md border border-dashed border-line-strong text-xs text-ink-3">Not captured yet</div>
      )}
    </figure>
  );
}

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const d = db();
  const v = getApplicationView(d, Number(raw));
  if (!v) notFound();
  const { application: a, posting: p, resume, answers, events } = v;
  const dryRun = getSettings(d).dryRun;
  const hasPending = answers.some((x) => x.pending);
  const pendingCount = answers.filter((x) => x.pending).length;

  return (
    <>
      <PageHeader
        title={p.company}
        meta={
          <Link href="/pipeline" className="hover:underline">
            Back to pipeline
          </Link>
        }
      />
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-6">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-ink">{p.title}</h2>
            <StatusPill status={a.status} />
            {a.dryRun && (
              <span className="inline-flex h-5 items-center rounded border border-dashed border-line-strong px-1.5 text-2xs font-medium text-ink-2" title="This application stopped before the submit click.">
                Dry run
              </span>
            )}
          </div>
          <p className="text-[13px] text-ink-2">
            {p.location || "No location listed"} · <span className="text-ink-3">{p.ats}</span>
          </p>
          <p className="text-[13px] text-ink-2">
            <span className="text-ink-3">Match </span>
            <span className="font-mono tabular text-ink">{a.matchScore == null ? "—" : Math.round(a.matchScore)}</span>
            {a.matchReason && <span className="text-ink-3"> · {a.matchReason}</span>}
          </p>
          {a.lastError && a.status === "failed" && <p className="text-[13px] font-medium text-bad">{a.lastError}</p>}
          <div className="flex flex-wrap gap-4 text-[13px]">
            <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink hover:underline">
              View posting <ExternalLink className="size-3" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <a href={p.applyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink hover:underline">
              Open application form <ExternalLink className="size-3" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </header>

        <ApplicationActions id={a.id} status={a.status} dryRun={dryRun} needsUserReason={a.needsUserReason} approved={Boolean(a.approvedAt)} hasPending={hasPending} />

        <section aria-labelledby="answers-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <h2 id="answers-heading" className="text-sm font-semibold text-ink">
              Answers
            </h2>
            <span className="font-mono text-xs text-ink-3 tabular">{answers.length}</span>
            {pendingCount > 0 && (
              <Link href="/needs-input" className="ml-auto text-xs font-medium text-warn hover:underline">
                {pendingCount} {pendingCount === 1 ? "question needs" : "questions need"} your answer
              </Link>
            )}
          </div>
          {answers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-[13px] text-ink-2">No answers yet. They appear once the worker has read the application form.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {answers.map((x) => (
                <li key={x.id} className={cn("flex flex-col gap-1 px-4 py-3", x.pending && "bg-warn-soft")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">{x.label}</span>
                    {x.required && <span className="text-2xs text-ink-3">Required</span>}
                    <span className="ml-auto flex items-center gap-2">
                      {x.pending ? (
                        <span className="rounded bg-warn-soft px-1.5 py-px text-2xs font-medium text-warn ring-1 ring-warn/40">Needs your answer</span>
                      ) : x.source ? (
                        <span className="rounded bg-surface-2 px-1.5 py-px text-2xs font-medium text-ink-2">{SOURCES[x.source] ?? x.source}</span>
                      ) : null}
                      {x.confidence != null && <span className="font-mono text-2xs text-ink-3 tabular" title="Confidence">{Math.round(x.confidence * 100)}%</span>}
                    </span>
                  </div>
                  {x.pending ? (
                    <p className="text-[13px] text-ink-2">
                      <Link href="/needs-input" className="font-medium underline">
                        Answer this in Needs input
                      </Link>
                    </p>
                  ) : (
                    <p className="text-[13px] break-words whitespace-pre-wrap text-ink">{x.answerDisplay || <span className="text-ink-3">No answer</span>}</p>
                  )}
                  {x.reason && <p className="text-xs text-ink-3">{x.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="cover-heading" className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 id="cover-heading" className="text-sm font-semibold text-ink">
              Cover letter
            </h2>
            {a.coverLetter && (
              <span className="ml-auto">
                <CopyButton text={a.coverLetter} label="Copy cover letter" />
              </span>
            )}
          </div>
          {a.coverLetter ? (
            <div className="rounded-lg border border-line bg-surface px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{a.coverLetter}</div>
          ) : (
            <p className="text-[13px] text-ink-3">No cover letter for this application.</p>
          )}
        </section>

        <section aria-labelledby="resume-heading" className="flex flex-col gap-2">
          <h2 id="resume-heading" className="text-sm font-semibold text-ink">
            Resume
          </h2>
          <p className="text-[13px] text-ink-2">
            {resume ? (
              <>
                {resume.label} <span className="text-ink-3">· {resume.filename}</span>
              </>
            ) : (
              <span className="text-ink-3">No resume attached yet.</span>
            )}
          </p>
        </section>

        <section aria-labelledby="shots-heading" className="flex flex-col gap-3">
          <h2 id="shots-heading" className="text-sm font-semibold text-ink">
            Screenshots
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Shot title="Before submit" name={a.preSubmitScreenshot} />
            <Shot title="After submit" name={a.postSubmitScreenshot} />
          </div>
        </section>

        <section aria-labelledby="timeline-heading" className="flex flex-col gap-3">
          <h2 id="timeline-heading" className="text-sm font-semibold text-ink">
            Timeline
          </h2>
          {events.length === 0 ? (
            <p className="text-[13px] text-ink-3">No events recorded.</p>
          ) : (
            <ol className="flex flex-col rounded-lg border border-line bg-surface">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-4 py-2 text-[13px] last:border-b-0">
                  <span className="text-ink">
                    {e.fromStatus ? `${statusLabel(e.fromStatus)} → ` : ""}
                    {statusLabel(e.toStatus)}
                  </span>
                  {e.detail && <span className="text-ink-3">{e.detail}</span>}
                  <time dateTime={e.at} className="ml-auto font-mono text-xs text-ink-3 tabular">
                    {formatDateTime(e.at)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

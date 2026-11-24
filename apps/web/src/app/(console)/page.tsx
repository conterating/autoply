import { getProfile, getSettings, recentActivity, submittedToday, todayCounts } from "@autoply/core/db";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { PunchStrip } from "@/components/punch-strip";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { LiveRefresh, WorkerDot, WorkerToggle } from "@/components/shell/worker-control";
import { StatusPill } from "@/components/status";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { formatTime, formatToday } from "@/lib/format";
import { getWorkerView } from "@/lib/shell";

export const metadata = { title: "Home" };

export default function HomePage() {
  const d = db();
  const profile = getProfile(d);
  const settings = getSettings(d);
  const counts = todayCounts(d);
  const sent = submittedToday(d);
  const activity = recentActivity(d);
  const worker = getWorkerView();
  const onboarded = Boolean(profile.onboarding.completedAt);

  const stats = [
    { label: "Found", value: counts.found, href: "/pipeline" },
    { label: "Applied", value: counts.applied, href: "/pipeline?status=submitted" },
    { label: "Waiting on you", value: counts.waiting, href: "/needs-input", tone: counts.waiting > 0 ? "text-warn" : "" },
    { label: "Failed", value: counts.failed, href: "/pipeline?status=failed", tone: counts.failed > 0 ? "text-bad" : "" },
  ];

  return (
    <>
      <LiveRefresh />
      <PageHeader
        title="Home"
        meta={formatToday()}
        actions={
          <>
            <WorkerDot worker={worker} />
            {onboarded && <WorkerToggle worker={worker} />}
          </>
        }
      />
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-6">
        {!onboarded && (
          <section
            aria-labelledby="setup-heading"
            className="flex flex-wrap items-center gap-6 rounded-lg border border-line bg-surface p-6"
          >
            <div className="min-w-64 flex-1">
              <h2 id="setup-heading" className="font-display-wide text-lg font-semibold">
                Set up your profile
              </h2>
              <p className="mt-1 max-w-prose text-[13px] text-ink-2">
                Upload your resume and confirm every answer Autoply will give on your behalf: contact details, work
                history, work authorization, and the voluntary self-identification questions. Nothing is sent until
                you’ve confirmed it. Takes about 15 minutes.
              </p>
            </div>
            <Button asChild variant="primary" size="lg">
              <Link href="/onboarding">
                Start with your resume <ArrowRight aria-hidden />
              </Link>
            </Button>
          </section>
        )}

        <section aria-labelledby="today-heading">
          <h2 id="today-heading" className="mb-3 text-xs font-medium tracking-wide text-ink-3 uppercase">
            Today
          </h2>
          <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4 [&>*]:bg-surface gap-px">
            {stats.map((s) => (
              <Link key={s.label} href={s.href} className="group flex flex-col gap-1 px-5 py-4 hover:!bg-surface-2">
                <span className="text-xs text-ink-3 group-hover:text-ink-2">{s.label}</span>
                <span className={`font-display-wide text-3xl font-semibold tabular ${s.tone ?? ""}`}>{s.value}</span>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="cap-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="cap-heading" className="text-xs font-medium tracking-wide text-ink-3 uppercase">
              Daily limit
            </h2>
            <p className="text-xs text-ink-3">
              <span className="font-mono text-ink tabular">{sent}</span> of{" "}
              <span className="font-mono tabular">{settings.dailyCap}</span> sent · resets at midnight
            </p>
          </div>
          <PunchStrip used={sent} cap={settings.dailyCap} />
          {settings.dryRun && (
            <p className="text-xs text-ink-3">
              Dry run is on: forms are filled and saved for review but never submitted, so nothing counts against the
              limit. <Link href="/settings" className="text-carbon underline underline-offset-2">Change in Settings</Link>
            </p>
          )}
        </section>

        <section aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="mb-3 text-xs font-medium tracking-wide text-ink-3 uppercase">
            Recent activity
          </h2>
          {activity.length === 0 ? (
            <EmptyState title="No activity yet">
              {onboarded
                ? "Start applying and each job the worker finds, fills or sends shows up here."
                : "Once your profile is set up and the worker is running, each job it finds, fills or sends shows up here."}
            </EmptyState>
          ) : (
            <ol className="divide-y divide-line rounded-lg border border-line bg-surface">
              {activity.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/applications/${e.applicationId}`}
                    className="flex items-center gap-4 px-4 py-2.5 text-[13px] hover:bg-surface-2"
                  >
                    <time dateTime={e.at} className="w-16 shrink-0 font-mono text-xs text-ink-3 tabular">
                      {formatTime(e.at)}
                    </time>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{e.company}</span>
                      <span className="text-ink-3"> · </span>
                      <span className="text-ink-2">{e.title}</span>
                    </span>
                    <StatusPill status={e.toStatus} />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

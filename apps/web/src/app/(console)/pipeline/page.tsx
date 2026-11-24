import { getSettings } from "@autoply/core/db";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { PipelineTable } from "@/components/pipeline/pipeline-table";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { activePreset, pipelineHref, parseFilters, queryPipeline, STATUS_PRESETS } from "@/lib/pipeline";

export const metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseFilters(await searchParams);
  const d = db();
  const dryRun = getSettings(d).dryRun;
  const { rows, total, page, pages, everything, atsOptions } = queryPipeline(d, f);
  const preset = activePreset(f.statuses);
  const filtered = f.statuses.length > 0 || f.q !== "" || f.ats !== "";

  return (
    <>
      <PageHeader title="Pipeline" meta={everything ? <span className="font-mono tabular">{total} {total === 1 ? "application" : "applications"}</span> : undefined} />
      <div className="mx-auto max-w-6xl px-6 py-6">
        {everything === 0 ? (
          <EmptyState
            title="No applications yet"
            action={
              <Button asChild variant="primary">
                <Link href="/settings">
                  Add a company board <ArrowRight aria-hidden />
                </Link>
              </Button>
            }
          >
            Every job the worker finds appears here with its match score and status. Add company boards in Settings, then start the worker from Home.
          </EmptyState>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <nav aria-label="Status filter" className="flex flex-wrap gap-1.5">
                {STATUS_PRESETS.map((p) => (
                  <Link
                    key={p.id}
                    href={pipelineHref({ ...f, statuses: [...p.statuses], page: 1 })}
                    aria-current={preset === p.id ? "page" : undefined}
                    className={cn(
                      "inline-flex h-8 items-center rounded-md border px-3 text-[13px]",
                      preset === p.id ? "border-carbon bg-carbon-soft text-ink" : "border-line-strong bg-surface text-ink-2 hover:border-ink-3",
                    )}
                  >
                    {p.label}
                  </Link>
                ))}
              </nav>
              <form action="/pipeline" method="get" role="search" className="ml-auto flex items-center gap-2">
                {f.statuses.map((s) => (
                  <input key={s} type="hidden" name="status" value={s} />
                ))}
                <label htmlFor="pipeline-q" className="sr-only">Search company or title</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-ink-3" aria-hidden />
                  <Input id="pipeline-q" name="q" type="search" defaultValue={f.q} placeholder="Search company or title" className="w-56 pl-8" />
                </div>
                <label htmlFor="pipeline-ats" className="sr-only">Source</label>
                <Select id="pipeline-ats" name="ats" defaultValue={f.ats} className="w-36">
                  <option value="">All sources</option>
                  {atsOptions.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
                <Button type="submit">Apply filters</Button>
                {filtered && (
                  <Button asChild variant="ghost">
                    <Link href="/pipeline">Clear filters</Link>
                  </Button>
                )}
              </form>
            </div>

            {rows.length === 0 ? (
              <EmptyState
                title="No applications match these filters"
                action={
                  <Button asChild>
                    <Link href="/pipeline">Show all applications</Link>
                  </Button>
                }
              >
                Try a different status or search term.
              </EmptyState>
            ) : (
              <PipelineTable key={`${page}-${f.q}-${f.ats}-${f.statuses.join()}`} rows={rows} dryRun={dryRun} />
            )}

            {pages > 1 && (
              <nav aria-label="Pagination" className="mt-4 flex items-center gap-3 text-xs text-ink-3">
                {page > 1 ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={pipelineHref({ ...f, page: page - 1 })}>
                      <ArrowLeft aria-hidden /> Previous
                    </Link>
                  </Button>
                ) : null}
                <span className="font-mono tabular">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={pipelineHref({ ...f, page: page + 1 })}>
                      Next <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                ) : null}
              </nav>
            )}
          </>
        )}
      </div>
    </>
  );
}

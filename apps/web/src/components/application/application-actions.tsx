"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveApplications,
  markSubmittedByUser,
  putBackInQueue,
  retryApplication,
  withdrawApplication,
  type ApplicationActionResult,
} from "@/app/actions/applications";
import { Button } from "@/components/ui/button";
import type { ApplicationStatus } from "@autoply/core";

const DRY_RUN_EXPLANATION = "Dry run is on, so nothing is sent. Turn it off in Settings to send applications.";
const PRE_SUBMIT: ApplicationStatus[] = ["matched", "queued", "needs_input"];

export function ApplicationActions({
  id,
  status,
  dryRun,
  needsUserReason,
  approved,
  hasPending,
}: {
  id: number;
  status: ApplicationStatus;
  dryRun: boolean;
  needsUserReason: string | null;
  approved: boolean;
  hasPending: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<ApplicationActionResult>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  const withdraw = (
    <Button type="button" variant="danger" disabled={pending} onClick={() => run(() => withdrawApplication(id))}>
      Withdraw
    </Button>
  );

  let body: React.ReactNode = null;
  if (status === "ready") {
    body = (
      <>
        {approved ? (
          <p className="text-[13px] text-ink-2">Approved. The worker will send it next.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="primary" disabled={pending || dryRun || hasPending} aria-describedby="approve-note" onClick={() => run(() => approveApplications([id]))}>
                Approve and send
              </Button>
              {withdraw}
            </div>
            <p id="approve-note" className="text-xs text-ink-3">
              {dryRun ? DRY_RUN_EXPLANATION : hasPending ? "Answer the open questions in Needs input first." : "The worker sends it with exactly the answers shown here."}
            </p>
          </>
        )}
        {approved && <div>{withdraw}</div>}
      </>
    );
  } else if (status === "needs_user") {
    body = (
      <>
        <p className="text-[13px] text-ink-2">{needsUserReason ?? "Autoply stopped because this step needs a person."}</p>
        <p className="text-[13px] text-ink-2">Open the browser window Autoply left open, finish the step there, then mark it done.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" disabled={pending} onClick={() => run(() => markSubmittedByUser(id))}>
            I submitted it
          </Button>
          <Button type="button" disabled={pending} onClick={() => run(() => putBackInQueue(id))}>
            Put back in queue
          </Button>
        </div>
      </>
    );
  } else if (status === "failed") {
    body = (
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" disabled={pending} onClick={() => run(() => retryApplication(id))}>
          Retry
        </Button>
      </div>
    );
  } else if (PRE_SUBMIT.includes(status)) {
    body = <div>{withdraw}</div>;
  }
  if (!body) return null;
  return (
    <section aria-labelledby="actions-heading" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h2 id="actions-heading" className="text-sm font-semibold text-ink">
        Actions
      </h2>
      {body}
      <p role="alert" className="text-xs font-medium text-bad empty:hidden">
        {error}
      </p>
    </section>
  );
}

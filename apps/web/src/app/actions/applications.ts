"use server";

import { transition } from "@autoply/core/applications/transition";
import { getSettings, schema } from "@autoply/core/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

export type ApplicationActionResult = { ok: true; approved?: number } | { ok: false; error: string };

const DRY_RUN_ERROR = "Dry run is on, so nothing is sent. Turn it off in Settings to send applications.";

function fail(e: unknown): ApplicationActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." };
}

/** Marks `ready` applications with no pending questions as approved; the worker submits them. */
export async function approveApplications(ids: number[]): Promise<ApplicationActionResult> {
  const d = db();
  if (getSettings(d).dryRun) return { ok: false, error: DRY_RUN_ERROR };
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!clean.length) return { ok: false, error: "Select at least one application that is ready to send." };
  const { applications: a, applicationAnswers: ans } = schema;
  try {
    const result = d.update(a)
      .set({ approvedAt: new Date().toISOString(), updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` })
      .where(
        and(
          inArray(a.id, clean),
          eq(a.status, "ready"),
          sql`not exists (select 1 from ${ans} where ${ans.applicationId} = ${a.id} and ${ans.pending} = 1)`,
        ),
      )
      .run();
    revalidatePath("/", "layout");
    if (result.changes === 0) return { ok: false, error: "None of those applications can be approved. Only ready applications with no open questions can be sent." };
    return { ok: true, approved: result.changes };
  } catch (e) {
    return fail(e);
  }
}

function move(id: number, to: "queued" | "submitted" | "withdrawn", detail: string, patch = {}): ApplicationActionResult {
  try {
    transition(db(), id, to, detail, patch);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function withdrawApplication(id: number) {
  return move(id, "withdrawn", "You withdrew this application");
}

export async function retryApplication(id: number) {
  return move(id, "queued", "You retried this application", { lastError: null, needsUserReason: null });
}

export async function markSubmittedByUser(id: number) {
  return move(id, "submitted", "You submitted it yourself in the browser", { submittedAt: new Date().toISOString(), needsUserReason: null });
}

export async function putBackInQueue(id: number) {
  return move(id, "queued", "You put this back in the queue", { needsUserReason: null });
}

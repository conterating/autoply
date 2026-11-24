"use server";

import { SettingsSchema, type Settings } from "@autoply/core";
import { getSettings, saveSettings, schema } from "@autoply/core/db";
import { dataPaths } from "@autoply/core/paths";
import { deleteApiKey, setApiKey } from "@autoply/core/secrets";
import { eq } from "drizzle-orm";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export type SettingsResult = { ok: true } | { ok: false; error?: string; issues?: { path: string; message: string }[] };

function saveMerged(patch: Partial<Settings>): SettingsResult {
  const d = db();
  const parsed = SettingsSchema.safeParse({ ...getSettings(d), ...patch });
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      error: "Fix the highlighted fields and save again.",
    };
  }
  saveSettings(d, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveApplyingSettings(input: {
  mode: string;
  dryRun: boolean;
  dailyCap: number;
  pacing: { minSeconds: number; maxSeconds: number };
  matchThreshold: number;
  autopilotMatchThreshold: number;
  answerConfidenceThreshold: number;
}): Promise<SettingsResult> {
  return saveMerged(input as Partial<Settings>);
}

export async function saveModelSettings(models: { classify: string; write: string; parse: string }): Promise<SettingsResult> {
  return saveMerged({ models });
}

export async function saveCommunityLists(urls: string[]): Promise<SettingsResult> {
  const clean = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  const bad = clean.findIndex((u) => !URL.canParse(u) || !/^https?:\/\//i.test(u));
  if (bad >= 0) return { ok: false, error: `"${clean[bad]}" isn't a web address. Use a full URL that starts with https://.` };
  return saveMerged({ communityLists: clean });
}

export async function saveApiKey(key: string): Promise<SettingsResult> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: "Paste your Claude API key first." };
  if (!/^sk-[\w-]{10,}$/.test(trimmed)) return { ok: false, error: "That doesn't look like a Claude API key. Keys start with sk- and have no spaces." };
  try {
    await setApiKey(trimmed);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save the key to the OS keychain." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeApiKey(): Promise<SettingsResult> {
  try {
    await deleteApiKey();
  } catch {
    return { ok: false, error: "Couldn't remove the key from the OS keychain." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

const TOKEN = /^[A-Za-z0-9_-]+$/;

export async function addSource(input: { ats: string; boardToken: string; companyName: string }): Promise<SettingsResult> {
  const boardToken = input.boardToken.trim();
  const companyName = input.companyName.trim();
  if (!(["greenhouse", "lever", "ashby"] as const).includes(input.ats as never)) return { ok: false, error: "Choose Greenhouse, Lever or Ashby." };
  if (!TOKEN.test(boardToken)) return { ok: false, error: "The board token can only use letters, numbers, - and _. It's the last part of the company's job board URL." };
  if (!companyName) return { ok: false, error: "Enter the company name." };
  try {
    db()
      .insert(schema.sources)
      .values({ ats: input.ats as "greenhouse" | "lever" | "ashby", boardToken, companyName })
      .run();
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) return { ok: false, error: "That board is already in your list." };
    return { ok: false, error: "Couldn't add the board. Try again." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function setSourceEnabled(id: number, enabled: boolean): Promise<SettingsResult> {
  db().update(schema.sources).set({ enabled }).where(eq(schema.sources.id, id)).run();
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeSource(id: number): Promise<SettingsResult> {
  db().delete(schema.sources).where(eq(schema.sources.id, id)).run();
  revalidatePath("/settings");
  return { ok: true };
}

async function emptyDir(dir: string) {
  await mkdir(dir, { recursive: true });
  for (const name of await readdir(dir)) await rm(join(dir, name), { recursive: true, force: true });
}

export async function deleteAllData(confirmation: string): Promise<SettingsResult> {
  if (confirmation.trim() !== "DELETE") return { ok: false, error: "Type DELETE exactly as shown to confirm." };
  const d = db();
  const s = schema;
  d.transaction((tx) => {
    // Children first so foreign keys never block.
    for (const t of [s.applicationEvents, s.applicationAnswers, s.applications, s.postings, s.sources, s.documents, s.answerBank, s.profile, s.settings, s.workerState]) {
      tx.delete(t).run();
    }
  });
  try {
    const paths = dataPaths();
    await emptyDir(paths.documents);
    await emptyDir(paths.screenshots);
  } catch {
    return { ok: false, error: "Your records were deleted, but some files couldn't be removed. Delete the documents and screenshots folders by hand." };
  }
  revalidatePath("/", "layout");
  redirect("/");
}

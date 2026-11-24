import { accessSync, constants, existsSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "@autoply/core/db";
import { ensureDataDirs } from "@autoply/core/paths";
import { WEB_DIR } from "./processes.ts";

export type Check = { name: string; ok: boolean; detail: string; fix?: string };

export async function runDoctor(): Promise<Check[]> {
  const checks: Check[] = [];

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node.js",
    ok: major >= 22,
    detail: `v${process.versions.node}`,
    fix: "Install Node.js 22 or newer.",
  });

  try {
    const paths = ensureDataDirs();
    accessSync(paths.home, constants.W_OK);
    checks.push({ name: "Data directory", ok: true, detail: paths.home });
  } catch (e) {
    checks.push({ name: "Data directory", ok: false, detail: String(e), fix: "Check permissions on ~/.autoply or set AUTOPLY_HOME." });
  }

  try {
    const db = getDb();
    db.$client.prepare("SELECT 1").get();
    checks.push({ name: "Database", ok: true, detail: "Opened and migrated" });
  } catch (e) {
    checks.push({ name: "Database", ok: false, detail: String(e), fix: "Run `pnpm install` to rebuild better-sqlite3." });
  }

  const built = existsSync(join(WEB_DIR, ".next", "BUILD_ID"));
  checks.push({
    name: "Dashboard build",
    ok: built,
    detail: built ? "Built" : "Not built yet",
    fix: "`autoply start` builds it automatically, or run `pnpm build`.",
  });

  try {
    const { chromium } = await import("playwright");
    const exe = chromium.executablePath();
    const ok = existsSync(exe);
    checks.push({
      name: "Browser (Chromium)",
      ok,
      detail: ok ? exe : "Not installed",
      fix: "Run `pnpm exec playwright install chromium`.",
    });
  } catch (e) {
    checks.push({ name: "Browser (Chromium)", ok: false, detail: String(e), fix: "Run `pnpm install`." });
  }

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  checks.push({
    name: "Claude API key",
    ok: hasKey,
    detail: hasKey ? "Found in environment" : "Not set in environment (the key saved in Settings is checked once that lands)",
    fix: "Set ANTHROPIC_API_KEY or add it in Settings.",
  });

  return checks;
}

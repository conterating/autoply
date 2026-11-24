import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDataDirs } from "@autoply/core/paths";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const WEB_DIR = join(REPO_ROOT, "apps", "web");
export const WORKER_DIR = join(REPO_ROOT, "apps", "worker");

export type ServiceName = "web" | "worker";

export function pidFile(name: ServiceName) {
  return join(ensureDataDirs().run, `${name}.pid`);
}

export function readPid(name: ServiceName): number | null {
  const file = pidFile(name);
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function isAlive(pid: number | null): pid is number {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function runningPid(name: ServiceName): number | null {
  const pid = readPid(name);
  if (isAlive(pid)) return pid;
  if (pid) rmSync(pidFile(name), { force: true });
  return null;
}

/** Starts a detached background process with output going to ~/.autoply/logs/<name>.log. */
export function startDetached(name: ServiceName, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const paths = ensureDataDirs();
  const log = openSync(join(paths.logs, `${name}.log`), "a");
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", log, log] });
  child.unref();
  if (!child.pid) throw new Error(`Could not start ${name}`);
  writeFileSync(pidFile(name), String(child.pid));
  return child.pid;
}

export async function stopService(name: ServiceName, timeoutMs = 10_000): Promise<boolean> {
  const pid = runningPid(name);
  if (!pid) return false;
  // Detached children lead their own process group; signal the whole group so
  // Next.js's child processes go too.
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isAlive(pid)) await new Promise((r) => setTimeout(r, 200));
  if (isAlive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
  }
  rmSync(pidFile(name), { force: true });
  return true;
}

export async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export function portFile() {
  return join(ensureDataDirs().run, "web.port");
}

export function readPort(): number | null {
  const file = portFile();
  if (!existsSync(file)) return null;
  return Number(readFileSync(file, "utf8").trim()) || null;
}

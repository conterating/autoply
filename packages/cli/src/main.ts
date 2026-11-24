import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { getDb } from "@autoply/core/db";
import { autoplyHome } from "@autoply/core/paths";
import { ADAPTERS, isWorkerAlive, openBrowser, readWorkerState, runOnce } from "@autoply/worker";
import { createLlm, llmAvailable } from "@autoply/core/llm";
import { getSettings } from "@autoply/core/db";
import { runDoctor } from "./doctor.ts";
import {
  portFile,
  readPort,
  runningPid,
  startDetached,
  stopService,
  waitForHttp,
  WEB_DIR,
  WORKER_DIR,
} from "./processes.ts";

const DEFAULT_PORT = Number(process.env.AUTOPLY_PORT ?? 4310);

const program = new Command()
  .name("autoply")
  .description("Finds jobs that match your profile and applies to them for you.");

program
  .command("start")
  .description("Start the dashboard and the background worker")
  .option("-p, --port <port>", "Dashboard port", String(DEFAULT_PORT))
  .option("--no-open", "Don't open the dashboard in a browser")
  .option("--rebuild", "Rebuild the dashboard before starting")
  .action(async (opts: { port: string; open: boolean; rebuild?: boolean }) => {
    const port = Number(opts.port);
    getDb(); // create data dir + migrate before anything else touches it

    if (runningPid("web")) {
      console.log(`Dashboard already running at http://localhost:${readPort() ?? port}`);
    } else {
      if (opts.rebuild || !existsSync(join(WEB_DIR, ".next", "BUILD_ID"))) {
        console.log("Building the dashboard (first run only)…");
        const build = spawnSync("pnpm", ["--filter", "@autoply/web", "build"], { stdio: "inherit", cwd: WEB_DIR });
        if (build.status !== 0) {
          console.error("Dashboard build failed. See the output above.");
          process.exit(1);
        }
      }
      startDetached("web", join(WEB_DIR, "node_modules", ".bin", "next"), ["start", "-p", String(port), "-H", "127.0.0.1"], WEB_DIR, {
        ...process.env,
        AUTOPLY_HOME: autoplyHome(),
        NODE_ENV: "production",
      });
      writeFileSync(portFile(), String(port));
    }

    if (runningPid("worker")) {
      console.log("Worker already running.");
    } else {
      startDetached("worker", join(WORKER_DIR, "node_modules", ".bin", "tsx"), ["src/main.ts"], WORKER_DIR, {
        ...process.env,
        AUTOPLY_HOME: autoplyHome(),
      });
    }

    const url = `http://localhost:${readPort() ?? port}`;
    if (!(await waitForHttp(url, 60_000))) {
      console.error(`Dashboard didn't respond at ${url}. Check ${join(autoplyHome(), "logs", "web.log")}.`);
      process.exit(1);
    }
    console.log(`Autoply is running at ${url}`);
    if (opts.open) spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  });

program
  .command("stop")
  .description("Stop the dashboard and the worker")
  .action(async () => {
    const worker = await stopService("worker");
    const web = await stopService("web");
    console.log(worker || web ? "Stopped." : "Nothing was running.");
  });

program
  .command("status")
  .description("Show what's running")
  .action(() => {
    const web = runningPid("web");
    const worker = runningPid("worker");
    const state = readWorkerState(getDb());
    console.log(`Dashboard  ${web ? `running at http://localhost:${readPort()} (pid ${web})` : "stopped"}`);
    console.log(
      `Worker     ${worker ? `running (pid ${worker}), ${state?.desired === "running" ? "applying" : "paused"}` : "stopped"}` +
        (worker && !isWorkerAlive(state) ? ", not responding" : ""),
    );
    console.log(`Data       ${autoplyHome()}`);
  });

program
  .command("run")
  .description("Run one pass of the pipeline in the foreground")
  .option("--dry-run", "Fill forms but stop before clicking submit", true)
  .option("--no-dry-run", "Actually submit (respects Settings)")
  .option("--headed", "Show the browser window")
  .action(async (opts: { dryRun: boolean; headed?: boolean }) => {
    const db = getDb();
    const context = await openBrowser({ headless: !opts.headed });
    try {
      const llm = (await llmAvailable()) ? await createLlm(getSettings(db)) : null;
      const result = await runOnce(
        { db, adapters: ADAPTERS, newPage: () => context.newPage(), llm, workerId: `cli-${process.pid}` },
        { dryRun: opts.dryRun },
      );
      console.log(result.summary);
      for (const o of result.outcomes) console.log(`  #${o.applicationId} ${o.status}: ${o.detail}`);
    } finally {
      await context.close();
    }
  });

program
  .command("doctor")
  .description("Check that everything Autoply needs is installed and working")
  .action(async () => {
    const checks = await runDoctor();
    for (const c of checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.name.padEnd(20)} ${c.detail}`);
      if (!c.ok && c.fix) console.log(`  ${" ".repeat(20)} → ${c.fix}`);
    }
    process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
  });

await program.parseAsync();

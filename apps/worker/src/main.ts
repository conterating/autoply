import { ADAPTERS } from "./adapters.ts";
import { runWorker } from "./loop.ts";

const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => controller.abort());
}

console.log(`[worker] started pid=${process.pid}`);
await runWorker({ signal: controller.signal, adapters: ADAPTERS });
console.log("[worker] stopped");

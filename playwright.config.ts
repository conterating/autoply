import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4398);
const HOME = ".test-data/e2e";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 1360, height: 860 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 860 } } }],
  webServer: {
    // Fresh data directory per run; never the user's ~/.autoply.
    command: `rm -rf ${HOME} && pnpm --filter @autoply/web exec next start -p ${PORT} -H 127.0.0.1`,
    url: `http://localhost:${PORT}`,
    env: { AUTOPLY_HOME: `${process.cwd()}/${HOME}`, AUTOPLY_TEST: "1" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

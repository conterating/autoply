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
  // One server and database per run. Specs that need an empty database run first;
  // flows that build on each other run after, in file order.
  projects: [
    { name: "empty", testMatch: /shell\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 860 } } },
    {
      name: "flows",
      testIgnore: /shell\.spec\.ts/,
      dependencies: ["empty"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 860 } },
    },
  ],
  webServer: {
    // Fresh data directory per run; never the user's ~/.autoply.
    command: `rm -rf ${HOME} && pnpm --filter @autoply/web exec next start -p ${PORT} -H 127.0.0.1`,
    url: `http://localhost:${PORT}`,
    env: {
      AUTOPLY_HOME: `${process.cwd()}/${HOME}`,
      AUTOPLY_TEST: "1",
      // Recorded LLM responses only: e2e never calls the live API.
      AUTOPLY_LLM_MODE: "replay",
      AUTOPLY_LLM_FIXTURES: `${process.cwd()}/tests/fixtures/llm`,
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

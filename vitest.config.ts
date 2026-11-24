import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{packages,apps}/*/test/**/*.test.ts", "tests/unit/**/*.test.ts"],
    environment: "node",
    // Every test run uses a throwaway data directory; never ~/.autoply.
    env: { AUTOPLY_HOME: ".test-data/vitest", NODE_ENV: "test" },
    testTimeout: 20_000,
  },
});

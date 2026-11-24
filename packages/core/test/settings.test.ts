import { describe, expect, it } from "vitest";
import { defaultSettings, SettingsSchema } from "../src/settings.ts";

describe("settings", () => {
  it("defaults to review mode, dry run, and a cap of 50", () => {
    const s = defaultSettings();
    expect(s.mode).toBe("review");
    expect(s.dryRun).toBe(true);
    expect(s.dailyCap).toBe(50);
  });

  it("rejects pacing where max < min", () => {
    expect(SettingsSchema.safeParse({ pacing: { minSeconds: 60, maxSeconds: 10 } }).success).toBe(false);
  });

  it.each([0, 501, 2.5])("rejects a daily cap of %s", (dailyCap) => {
    expect(SettingsSchema.safeParse({ dailyCap }).success).toBe(false);
  });
});

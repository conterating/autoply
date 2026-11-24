import { describe, expect, it } from "vitest";
import { HOLDOUT } from "../fixtures/resolver/holdout";
import { deterministicMatch } from "../../packages/core/src/resolver/resolve.ts";
import { isSensitiveKey } from "../../packages/core/src/resolver/catalog.ts";

describe("holdout resolver evaluation", () => {
  it("meets accuracy and safety thresholds", () => {
    const misses: string[] = [];
    const critical: string[] = [];
    let correct = 0;
    for (const item of HOLDOUT) {
      const field: Parameters<typeof deterministicMatch>[0] = {
        id: "x",
        label: item.label,
        type: item.type ?? (item.options ? "radio" : "text"),
        required: true,
        options: item.options?.map((o) => ({ value: o, label: o })),
      };
      const match = deterministicMatch(field);
      const resolved = match?.entry.key ?? "novel";
      const line = `"${item.label}" expected=${item.expected} resolved=${resolved}`;
      const ok = resolved === item.expected || (isSensitiveKey(item.expected) && resolved === "novel");
      if (ok) correct++;
      else misses.push(line);
      if (isSensitiveKey(resolved) && resolved !== item.expected) critical.push(line);
    }
    const acc = correct / HOLDOUT.length;
    const legal = HOLDOUT.filter((i) => isSensitiveKey(i.expected)).length;
    console.log(`items=${HOLDOUT.length} sensitive=${legal} accuracy=${acc.toFixed(4)}`);
    console.log(`MISSES (${misses.length}):\n${misses.join("\n")}`);
    console.log(`CRITICAL (${critical.length}):\n${critical.join("\n")}`);
    expect(critical).toEqual([]);
    expect(acc).toBeGreaterThanOrEqual(0.95);
  });
});

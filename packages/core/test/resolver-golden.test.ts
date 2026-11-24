import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AnthropicLlm, RecordingLlm } from "../src/llm/index.ts";
import { emptyProfile } from "../src/profile/schema.ts";
import { CATALOG_BY_KEY, deterministicMatch, isSensitiveKey, resolveField, type FormField } from "../src/resolver/index.ts";
import { defaultSettings } from "../src/settings.ts";
import { GOLDEN, type GoldenItem } from "../../../tests/fixtures/resolver/golden.ts";

function toField(item: GoldenItem, i: number): FormField {
  const options = item.options?.map((l) => ({ value: l, label: l }));
  return {
    id: `f${i}`,
    label: item.label,
    type: (item.type ?? (item.options ? "radio" : "text")) as FormField["type"],
    required: true,
    options,
  };
}

type Outcome = { item: GoldenItem; got: string; correct: boolean; critical: boolean };

function evaluate(): Outcome[] {
  return GOLDEN.map((item, i) => {
    const det = deterministicMatch(toField(item, i));
    const got = det?.entry.key ?? "novel";
    const expectedSensitive = isSensitiveKey(item.expected);
    // A sensitive question resolved as "novel" is routed to the user, which is safe.
    const correct = got === item.expected || (expectedSensitive && got === "novel");
    const critical = isSensitiveKey(got) && got !== item.expected;
    return { item, got, correct, critical };
  });
}

const fmt = (o: Outcome) => `  [${o.item.type ?? (o.item.options ? "radio" : "text")}] "${o.item.label}" expected=${o.item.expected} got=${o.got}`;

describe("resolver golden set (deterministic matching)", () => {
  const outcomes = evaluate();

  it("is large enough and only uses real catalog keys", () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(300);
    const bad = GOLDEN.filter((g) => g.expected !== "novel" && !CATALOG_BY_KEY.has(g.expected));
    expect(bad.map((b) => `${b.label} -> ${b.expected}`)).toEqual([]);
  });

  it("has no duplicate (label, type) pairs", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const g of GOLDEN) {
      const k = `${g.type ?? ""}|${g.label}`;
      if (seen.has(k)) dups.push(g.label);
      seen.add(k);
    }
    expect(dups).toEqual([]);
  });

  it("is at least 95% correct overall", () => {
    const misses = outcomes.filter((o) => !o.correct);
    const rate = 1 - misses.length / outcomes.length;
    expect(rate, `Misses:\n${misses.map(fmt).join("\n")}`).toBeGreaterThanOrEqual(0.95);
  });

  it("is 100% correct on legal and demographic questions (routing to the user counts)", () => {
    const sens = outcomes.filter((o) => isSensitiveKey(o.item.expected));
    expect(sens.length).toBeGreaterThan(80);
    const misses = sens.filter((o) => !o.correct);
    expect(misses.map(fmt), `Sensitive misses:\n${misses.map(fmt).join("\n")}`).toEqual([]);
  });

  it("never resolves a question to the wrong sensitive key", () => {
    const critical = outcomes.filter((o) => o.critical);
    expect(critical.map(fmt), `Critical errors:\n${critical.map(fmt).join("\n")}`).toEqual([]);
  });
});

describe.skipIf(process.env.AUTOPLY_LIVE_LLM !== "1")("resolver golden set (live LLM for deterministic misses)", () => {
  it("classifies deterministic misses correctly and records responses for replay", async () => {
    const dir = resolve(process.cwd(), "tests", "fixtures", "llm");
    const llm = new RecordingLlm(new AnthropicLlm(defaultSettings().models), dir);
    const misses = GOLDEN.map((item, i) => ({ item, field: toField(item, i) })).filter(({ field }) => !deterministicMatch(field));
    const wrong: string[] = [];
    for (const { item, field } of misses) {
      const r = await resolveField(field, {
        profile: emptyProfile(),
        findBankAnswer: () => null,
        llm,
        threshold: defaultSettings().answerConfidenceThreshold,
        company: "Acme",
        documents: {},
      });
      const got = r.canonicalKey ?? "novel";
      const ok = got === item.expected || (isSensitiveKey(item.expected) && got === "novel");
      if (!ok || (isSensitiveKey(got) && got !== item.expected)) wrong.push(`"${item.label}" expected=${item.expected} got=${got}`);
      // The LLM never supplies a sensitive answer, whatever it classifies.
      if (r.sensitive) expect(r.status).not.toBe("answered");
    }
    expect(wrong).toEqual([]);
  }, 600_000);
});


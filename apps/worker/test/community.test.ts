import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getSettings, openDb, saveSettings, schema } from "../../../packages/core/src/db/index.ts";
import { syncCommunityLists } from "../src/loop.ts";

const LIST = `
| Company | Role | Location | Application/Link | Date Posted |
| ------- | ---- | -------- | ---------------- | ----------- |
| **[Northwind](https://northwind.example)** | Software Engineer, New Grad | Austin, TX | <a href="https://job-boards.greenhouse.io/northwind/jobs/4410001"><img alt="Apply"></a> | Nov 20 |
| ↳ | Backend Engineer, New Grad | Remote | <a href="https://job-boards.greenhouse.io/northwind/jobs/4410002"><img alt="Apply"></a> | Nov 20 |
| **Contoso** | SWE I | Seattle, WA | <a href="https://jobs.lever.co/contoso/c0ffee01-5a1e-4b0b-9a10-000000000001/apply">Apply</a> | Nov 19 |
| **Closed Co** | SWE | NYC | 🔒 | Nov 1 |
| **Elsewhere** | SWE | NYC | <a href="https://careers.example.com/jobs/1">Apply</a> | Nov 1 |
`;

describe("community job lists", () => {
  it("adds every linked Greenhouse/Lever/Ashby board as a source, once", async () => {
    process.env.AUTOPLY_HOME = mkdtempSync(join(tmpdir(), "autoply-community-"));
    const db = openDb(join(process.env.AUTOPLY_HOME, "autoply.db"));
    saveSettings(db, { ...getSettings(db), communityLists: ["https://lists.example/new-grad.md"] });
    const fetchFn = (async () => new Response(LIST)) as typeof fetch;
    const deps = { db, adapters: {}, newPage: async () => { throw new Error("unused"); }, llm: null, workerId: "t", discovery: { fetch: fetchFn } };

    expect(await syncCommunityLists(deps, { force: true })).toBe(2);
    const sources = db.select().from(schema.sources).all().map((s) => `${s.ats}:${s.boardToken}`).sort();
    expect(sources).toEqual(["greenhouse:northwind", "lever:contoso"]);
    expect(await syncCommunityLists(deps, { force: true })).toBe(0);
  });
});

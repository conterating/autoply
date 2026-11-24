import { describe, expect, it } from "vitest";
import {
  getProfile,
  getSettings,
  migrate,
  openMemoryDb,
  saveProfile,
  saveSettings,
  schema,
  setDesired,
  readWorkerState,
} from "../src/db/index.ts";
import { emptyProfile } from "../src/profile/schema.ts";

function posting(overrides: Partial<typeof schema.postings.$inferInsert> = {}) {
  return {
    ats: "greenhouse" as const,
    externalId: "123",
    company: "Acme",
    title: "Engineer",
    url: "https://example.com/jobs/123",
    applyUrl: "https://example.com/jobs/123/apply",
    dedupeKey: "acme|engineer|remote",
    ...overrides,
  };
}

describe("database", () => {
  it("migrates idempotently", () => {
    const db = openMemoryDb();
    expect(migrate(db.$client)).toEqual([]);
  });

  it("returns an empty profile before one is saved, and round-trips a saved one", () => {
    const db = openMemoryDb();
    expect(getProfile(db)).toEqual(emptyProfile());
    const p = emptyProfile();
    p.identity.legalFirstName = { value: "Ada", confirmedByUser: true };
    saveProfile(db, p);
    expect(getProfile(db).identity.legalFirstName.value).toBe("Ada");
    p.identity.legalFirstName = { value: "Grace", confirmedByUser: true };
    saveProfile(db, p);
    expect(getProfile(db).identity.legalFirstName.value).toBe("Grace");
  });

  it("refuses to save an invalid profile", () => {
    const db = openMemoryDb();
    expect(() => saveProfile(db, { identity: { email: { value: "nope", confirmedByUser: true } } })).toThrow();
    expect(getProfile(db)).toEqual(emptyProfile());
  });

  it("round-trips settings", () => {
    const db = openMemoryDb();
    expect(getSettings(db).dailyCap).toBe(50);
    saveSettings(db, { ...getSettings(db), dailyCap: 20 });
    expect(getSettings(db).dailyCap).toBe(20);
  });

  it("dedupes postings on ats + external id", () => {
    const db = openMemoryDb();
    db.insert(schema.postings).values(posting()).run();
    expect(() => db.insert(schema.postings).values(posting({ dedupeKey: "other" })).run()).toThrow(/UNIQUE/);
  });

  it("dedupes postings on company + title + location", () => {
    const db = openMemoryDb();
    db.insert(schema.postings).values(posting()).run();
    expect(() =>
      db.insert(schema.postings).values(posting({ ats: "lever", externalId: "abc" })).run(),
    ).toThrow(/UNIQUE/);
  });

  it("allows at most one application per posting", () => {
    const db = openMemoryDb();
    const { id } = db.insert(schema.postings).values(posting()).returning({ id: schema.postings.id }).get();
    db.insert(schema.applications).values({ postingId: id }).run();
    expect(() => db.insert(schema.applications).values({ postingId: id }).run()).toThrow(/UNIQUE/);
  });

  it("stores worker desired state", () => {
    const db = openMemoryDb();
    expect(readWorkerState(db)).toBeNull();
    setDesired(db, "running");
    expect(readWorkerState(db)?.desired).toBe("running");
  });
});

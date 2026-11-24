import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { ensureDataDirs } from "../paths.ts";
import { MIGRATIONS } from "./migrations.generated.ts";
import * as schema from "./schema.ts";

export { schema };
export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function migrate(sqlite: Database.Database): string[] {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS __autoply_migrations (
    tag TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const applied = new Set(
    (sqlite.prepare("SELECT tag FROM __autoply_migrations").all() as { tag: string }[]).map((r) => r.tag),
  );
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.tag)) continue;
    sqlite.transaction(() => {
      for (const stmt of m.statements) sqlite.exec(stmt);
      sqlite.prepare("INSERT INTO __autoply_migrations (tag) VALUES (?)").run(m.tag);
    })();
    ran.push(m.tag);
  }
  return ran;
}

/** Opens (creating if needed) a database file and brings it up to date. */
export function openDb(file: string): Db {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  migrate(sqlite);
  return drizzle(sqlite, { schema }) as Db;
}

/** In-memory database for tests. */
export function openMemoryDb(): Db {
  return openDb(":memory:");
}

const g = globalThis as unknown as { __autoplyDb?: { home: string; db: Db } };

/** Process-wide database for the user's data directory. */
export function getDb(): Db {
  const paths = ensureDataDirs();
  if (!g.__autoplyDb || g.__autoplyDb.home !== paths.home) {
    g.__autoplyDb = { home: paths.home, db: openDb(paths.db) };
  }
  return g.__autoplyDb.db;
}

export * from "./repo.ts";
export * from "./worker-state.ts";
export * from "./queries.ts";
export * from "./answer-bank.ts";
export * from "./application-answers.ts";

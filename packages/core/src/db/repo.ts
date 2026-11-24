import { eq, sql } from "drizzle-orm";
import { emptyProfile, ProfileSchema, type Profile } from "../profile/schema.ts";
import { SettingsSchema, type Settings } from "../settings.ts";
import type { Db } from "./index.ts";
import { profile, settings } from "./schema.ts";

const PROFILE_ROW = 1;
const SETTINGS_KEY = "settings";

export function getProfile(db: Db): Profile {
  const row = db.select().from(profile).where(eq(profile.id, PROFILE_ROW)).get();
  if (!row) return emptyProfile();
  return ProfileSchema.parse(row.data);
}

/** Validates and saves the full profile. Throws a ZodError on invalid input. */
export function saveProfile(db: Db, next: unknown): Profile {
  const parsed = ProfileSchema.parse(next);
  db.insert(profile)
    .values({ id: PROFILE_ROW, data: parsed })
    .onConflictDoUpdate({
      target: profile.id,
      set: { data: parsed, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` },
    })
    .run();
  return parsed;
}

export function getSettings(db: Db): Settings {
  const row = db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
  return SettingsSchema.parse(row?.value ?? {});
}

export function saveSettings(db: Db, next: unknown): Settings {
  const parsed = SettingsSchema.parse(next);
  db.insert(settings)
    .values({ key: SETTINGS_KEY, value: parsed })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: parsed, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` },
    })
    .run();
  return parsed;
}

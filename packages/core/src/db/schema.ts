import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { APPLICATION_STATUSES } from "../applications/status.ts";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const createdAt = () => text("created_at").notNull().default(now);
const updatedAt = () => text("updated_at").notNull().default(now);

export const ATS_KINDS = ["greenhouse", "lever", "ashby", "workday", "fixture"] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

/** Single-row table holding the profile document (validated by ProfileSchema). */
export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey(),
  data: text("data", { mode: "json" }).notNull(),
  updatedAt: updatedAt(),
});

export const DOCUMENT_KINDS = ["resume", "transcript", "writing_sample", "cover_letter_example"] as const;

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
  label: text("label").notNull(),
  filename: text("filename").notNull(),
  /** Path relative to the documents directory. */
  storedPath: text("stored_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  extractedText: text("extracted_text"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

/**
 * Answers the user gave to questions that are not plain profile fields,
 * keyed by normalized question text so the same question is never asked twice.
 */
export const answerBank = sqliteTable(
  "answer_bank",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    normalizedQuestion: text("normalized_question").notNull(),
    questionText: text("question_text").notNull(),
    canonicalKey: text("canonical_key"),
    answer: text("answer", { mode: "json" }).notNull(),
    timesUsed: integer("times_used").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("answer_bank_question_uq").on(t.normalizedQuestion)],
);

/** Company job boards to poll during discovery. */
export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ats: text("ats", { enum: ATS_KINDS }).notNull(),
    boardToken: text("board_token").notNull(),
    companyName: text("company_name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastPolledAt: text("last_polled_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sources_ats_board_uq").on(t.ats, t.boardToken)],
);

export const postings = sqliteTable(
  "postings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ats: text("ats", { enum: ATS_KINDS }).notNull(),
    externalId: text("external_id").notNull(),
    sourceId: integer("source_id").references(() => sources.id, { onDelete: "set null" }),
    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location").notNull().default(""),
    workplaceType: text("workplace_type", { enum: ["remote", "hybrid", "onsite", "unknown"] })
      .notNull()
      .default("unknown"),
    url: text("url").notNull(),
    applyUrl: text("apply_url").notNull(),
    description: text("description").notNull().default(""),
    postedAt: text("posted_at"),
    /** normalize(company)|normalize(title)|normalize(location) — second dedupe key. */
    dedupeKey: text("dedupe_key").notNull(),
    raw: text("raw", { mode: "json" }),
    closedAt: text("closed_at"),
    discoveredAt: createdAt(),
  },
  (t) => [
    uniqueIndex("postings_ats_external_uq").on(t.ats, t.externalId),
    uniqueIndex("postings_dedupe_uq").on(t.dedupeKey),
  ],
);

export const applications = sqliteTable(
  "applications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** UNIQUE: a posting can be applied to at most once, ever. */
    postingId: integer("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "restrict" }),
    status: text("status", { enum: APPLICATION_STATUSES }).notNull().default("discovered"),
    matchScore: real("match_score"),
    matchReason: text("match_reason"),
    resumeDocumentId: integer("resume_document_id").references(() => documents.id, { onDelete: "set null" }),
    coverLetter: text("cover_letter"),
    preSubmitScreenshot: text("pre_submit_screenshot"),
    postSubmitScreenshot: text("post_submit_screenshot"),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(true),
    autopilotEligible: integer("autopilot_eligible", { mode: "boolean" }).notNull().default(false),
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(0),
    /** Worker lease for crash recovery. */
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    submittedAt: text("submitted_at"),
    confirmedAt: text("confirmed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("applications_posting_uq").on(t.postingId), index("applications_status_idx").on(t.status)],
);

export const ANSWER_SOURCES = ["profile", "answer_bank", "llm_draft", "user", "default", "document"] as const;

/** One row per form field on an application: exactly what was (or will be) entered. */
export const applicationAnswers = sqliteTable(
  "application_answers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fieldId: text("field_id").notNull(),
    label: text("label").notNull(),
    helpText: text("help_text"),
    fieldType: text("field_type").notNull(),
    required: integer("required", { mode: "boolean" }).notNull().default(false),
    options: text("options", { mode: "json" }),
    normalizedQuestion: text("normalized_question").notNull(),
    canonicalKey: text("canonical_key"),
    answer: text("answer", { mode: "json" }),
    /** Display form of the answer, e.g. the exact option label chosen. */
    answerDisplay: text("answer_display"),
    source: text("source", { enum: ANSWER_SOURCES }),
    confidence: real("confidence"),
    reason: text("reason"),
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("application_answers_field_uq").on(t.applicationId, t.fieldId),
    index("application_answers_pending_idx").on(t.pending, t.normalizedQuestion),
  ],
);

/** Every status transition, persisted. Also the application timeline. */
export const applicationEvents = sqliteTable(
  "application_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromStatus: text("from_status", { enum: APPLICATION_STATUSES }),
    toStatus: text("to_status", { enum: APPLICATION_STATUSES }).notNull(),
    detail: text("detail"),
    at: createdAt(),
  },
  (t) => [index("application_events_app_idx").on(t.applicationId)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: updatedAt(),
});

/** Worker heartbeat and control (single row). */
export const workerState = sqliteTable("worker_state", {
  id: integer("id").primaryKey(),
  desired: text("desired", { enum: ["running", "paused"] }).notNull().default("paused"),
  pid: integer("pid"),
  heartbeatAt: text("heartbeat_at"),
  activity: text("activity"),
  updatedAt: updatedAt(),
});

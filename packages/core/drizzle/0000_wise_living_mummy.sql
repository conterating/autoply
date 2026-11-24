CREATE TABLE `answer_bank` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`normalized_question` text NOT NULL,
	`question_text` text NOT NULL,
	`canonical_key` text,
	`answer` text NOT NULL,
	`times_used` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answer_bank_question_uq` ON `answer_bank` (`normalized_question`);--> statement-breakpoint
CREATE TABLE `application_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`field_id` text NOT NULL,
	`label` text NOT NULL,
	`help_text` text,
	`field_type` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`options` text,
	`normalized_question` text NOT NULL,
	`canonical_key` text,
	`answer` text,
	`answer_display` text,
	`source` text,
	`confidence` real,
	`reason` text,
	`pending` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_answers_field_uq` ON `application_answers` (`application_id`,`field_id`);--> statement-breakpoint
CREATE INDEX `application_answers_pending_idx` ON `application_answers` (`pending`,`normalized_question`);--> statement-breakpoint
CREATE TABLE `application_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_events_app_idx` ON `application_events` (`application_id`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`posting_id` integer NOT NULL,
	`status` text DEFAULT 'discovered' NOT NULL,
	`match_score` real,
	`match_reason` text,
	`resume_document_id` integer,
	`cover_letter` text,
	`pre_submit_screenshot` text,
	`post_submit_screenshot` text,
	`dry_run` integer DEFAULT true NOT NULL,
	`autopilot_eligible` integer DEFAULT false NOT NULL,
	`last_error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`submitted_at` text,
	`confirmed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`resume_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_posting_uq` ON `applications` (`posting_id`);--> statement-breakpoint
CREATE INDEX `applications_status_idx` ON `applications` (`status`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`filename` text NOT NULL,
	`stored_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`extracted_text` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `postings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ats` text NOT NULL,
	`external_id` text NOT NULL,
	`source_id` integer,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`workplace_type` text DEFAULT 'unknown' NOT NULL,
	`url` text NOT NULL,
	`apply_url` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`posted_at` text,
	`dedupe_key` text NOT NULL,
	`raw` text,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `postings_ats_external_uq` ON `postings` (`ats`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `postings_dedupe_uq` ON `postings` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ats` text NOT NULL,
	`board_token` text NOT NULL,
	`company_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_polled_at` text,
	`last_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_ats_board_uq` ON `sources` (`ats`,`board_token`);--> statement-breakpoint
CREATE TABLE `worker_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`desired` text DEFAULT 'paused' NOT NULL,
	`pid` integer,
	`heartbeat_at` text,
	`activity` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

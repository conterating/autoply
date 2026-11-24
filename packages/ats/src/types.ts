import type { Page } from "playwright";

import type { FieldAnswer, FormField } from "@autoply/core";

export type { FieldAnswer, FieldType, FormField } from "@autoply/core";

export type NormalizedPosting = {
  ats: string;
  externalId: string;
  company: string;
  title: string;
  location: string;
  workplaceType: "remote" | "hybrid" | "onsite" | "unknown";
  url: string;
  applyUrl: string;
  description: string;
  postedAt: string | null;
  raw?: unknown;
};

export type SubmitOutcome =
  | { ok: true }
  | { ok: false; reason: "captcha" | "verification" | "validation_error" | "closed" | "error"; message: string };

/** What's on the page after navigating to an application URL, before filling. */
export type PageState = { kind: "form" } | { kind: "closed"; message: string } | { kind: "blocked"; reason: "captcha" | "verification" | "login"; message: string };

export interface AtsAdapter {
  readonly kind: string;
  /** Navigates to the application form (from a posting or apply URL) and reports what's there. */
  open(page: Page, applyUrl: string): Promise<PageState>;
  discover(board: { boardToken: string; companyName: string }): Promise<NormalizedPosting[]>;
  extractForm(page: Page): Promise<FormField[]>;
  fill(page: Page, answers: Map<string, FieldAnswer>): Promise<void>;
  submit(page: Page): Promise<SubmitOutcome>;
  confirmSubmitted(page: Page): Promise<boolean>;
}

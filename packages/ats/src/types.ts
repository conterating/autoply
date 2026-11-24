import type { Page } from "playwright";

export type FieldType = "text" | "textarea" | "select" | "radio" | "checkbox" | "file" | "date" | "email" | "tel" | "number";

/** A form field as it appears on the page. */
export type FormField = {
  /** Stable id within the form (input name / id). */
  id: string;
  label: string;
  helpText?: string;
  type: FieldType;
  required: boolean;
  options?: { value: string; label: string }[];
  /** Multi-select checkboxes / multi selects. */
  multiple?: boolean;
  /** Page number in multi-page flows (0-based). */
  page?: number;
};

export type FieldAnswer =
  | { kind: "text"; value: string }
  | { kind: "option"; values: string[] }
  | { kind: "boolean"; value: boolean }
  | { kind: "file"; path: string; filename: string };

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

export interface AtsAdapter {
  readonly kind: string;
  discover(board: { boardToken: string; companyName: string }): Promise<NormalizedPosting[]>;
  extractForm(page: Page): Promise<FormField[]>;
  fill(page: Page, answers: Map<string, FieldAnswer>): Promise<void>;
  submit(page: Page): Promise<SubmitOutcome>;
  confirmSubmitted(page: Page): Promise<boolean>;
}

/**
 * Application state machine:
 *
 *   discovered → matched → queued → filling → needs_input | needs_user | ready
 *   ready → submitted → confirmed | failed
 *
 * plus the edges needed to make it operable: blocked states return to
 * `queued` once resolved, `filling` returns to `queued` when a crashed
 * worker's lease is reclaimed, non-matching postings are `skipped`, and any
 * pre-submit state can be `withdrawn` by the user or `failed` by the worker.
 *
 * `submitted` is terminal for retry purposes: once the submit click has been
 * recorded, nothing may move the application back to a state that could
 * submit again.
 */
export const APPLICATION_STATUSES = [
  "discovered",
  "matched",
  "skipped",
  "queued",
  "filling",
  "needs_input",
  "needs_user",
  "ready",
  "submitting",
  "submitted",
  "confirmed",
  "failed",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  discovered: ["matched", "skipped"],
  matched: ["queued", "skipped", "withdrawn"],
  skipped: ["matched"],
  queued: ["filling", "withdrawn", "failed"],
  filling: ["needs_input", "needs_user", "ready", "queued", "failed"],
  needs_input: ["queued", "withdrawn", "failed"],
  needs_user: ["queued", "ready", "submitted", "withdrawn", "failed"],
  ready: ["submitting", "queued", "withdrawn", "failed"],
  // `submitting` is written *before* the click; a crash here is never retried
  // automatically (the application may or may not have gone out).
  submitting: ["submitted", "needs_user", "failed"],
  submitted: ["confirmed", "failed"],
  confirmed: [],
  failed: ["queued"],
  withdrawn: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ApplicationStatus,
    readonly to: ApplicationStatus,
  ) {
    super(`Invalid application transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** States in which the submit button may have been clicked. Never re-queue these. */
export const POST_SUBMIT_STATUSES: readonly ApplicationStatus[] = ["submitting", "submitted", "confirmed"];

/** States that need a person. */
export const WAITING_ON_USER_STATUSES: readonly ApplicationStatus[] = ["needs_input", "needs_user", "ready"];

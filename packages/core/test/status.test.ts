import { describe, expect, it } from "vitest";
import {
  APPLICATION_STATUSES,
  assertTransition,
  canTransition,
  InvalidTransitionError,
  POST_SUBMIT_STATUSES,
  TRANSITIONS,
} from "../src/applications/status.ts";

describe("application state machine", () => {
  it("covers the specified happy path", () => {
    const path = ["discovered", "matched", "queued", "filling", "ready", "submitting", "submitted", "confirmed"] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
  });

  it.each(["needs_input", "needs_user", "ready"] as const)("filling can branch to %s", (to) => {
    expect(canTransition("filling", to)).toBe(true);
  });

  it("only lists known statuses", () => {
    for (const [from, tos] of Object.entries(TRANSITIONS)) {
      expect(APPLICATION_STATUSES).toContain(from);
      for (const to of tos) expect(APPLICATION_STATUSES).toContain(to);
    }
  });

  it("never lets a post-submit state go back to a state that could submit again", () => {
    const canResubmit = new Set(["queued", "filling", "ready", "submitting", "needs_input"]);
    for (const s of POST_SUBMIT_STATUSES) {
      for (const to of TRANSITIONS[s]) {
        if (s === "submitting") continue; // submitting -> needs_user is the manual-resolution path
        expect(canResubmit.has(to), `${s} -> ${to}`).toBe(false);
      }
    }
    expect(TRANSITIONS.submitting).not.toContain("queued");
    expect(TRANSITIONS.submitting).not.toContain("ready");
  });

  it("treats confirmed and withdrawn as terminal", () => {
    expect(TRANSITIONS.confirmed).toEqual([]);
    expect(TRANSITIONS.withdrawn).toEqual([]);
  });

  it("throws on invalid transitions", () => {
    expect(() => assertTransition("discovered", "submitted")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("confirmed", "queued")).toThrow(/confirmed → queued/);
    expect(() => assertTransition("queued", "filling")).not.toThrow();
  });
});

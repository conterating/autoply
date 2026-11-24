import { describe, expect, it } from "vitest";
import { assertSubmitAllowed, isLocalOrigin, SubmitBlockedError } from "../src/submit-guard.ts";

describe("submit guard (hard rule 4)", () => {
  it.each(["http://localhost:4399/greenhouse/x", "http://127.0.0.1:9/apply", "http://[::1]:80/"])("allows %s under test", (url) => {
    expect(() => assertSubmitAllowed(url, { NODE_ENV: "test" })).not.toThrow();
  });

  it.each([
    "https://boards.greenhouse.io/acme/jobs/1",
    "https://jobs.lever.co/acme/123/apply",
    "https://localhost.evil.com/apply",
    "https://127.0.0.1.nip.io/apply",
    "file:///etc/passwd",
    "not a url",
  ])("blocks %s under NODE_ENV=test", (url) => {
    expect(() => assertSubmitAllowed(url, { NODE_ENV: "test" })).toThrow(SubmitBlockedError);
  });

  it("blocks under AUTOPLY_TEST=1 too", () => {
    expect(() => assertSubmitAllowed("https://jobs.ashbyhq.com/x/application", { AUTOPLY_TEST: "1" })).toThrow(SubmitBlockedError);
  });

  it("allows real origins outside tests", () => {
    expect(() => assertSubmitAllowed("https://jobs.lever.co/acme/1/apply", { NODE_ENV: "production" })).not.toThrow();
  });

  it("recognises local origins precisely", () => {
    expect(isLocalOrigin("http://localhost:3000")).toBe(true);
    expect(isLocalOrigin("http://localhost.example.com")).toBe(false);
  });
});

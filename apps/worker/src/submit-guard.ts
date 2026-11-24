/**
 * Hard rule 4: tests never submit an application to a real employer.
 *
 * Under NODE_ENV=test or AUTOPLY_TEST=1 the worker refuses to click submit on
 * any page whose origin isn't localhost / 127.0.0.1. This check runs
 * immediately before every submit click, in every adapter.
 */
export class SubmitBlockedError extends Error {
  constructor(readonly url: string) {
    super(`Refusing to submit on ${url}: tests may only submit to localhost.`);
    this.name = "SubmitBlockedError";
  }
}

export function isTestEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "test" || env.AUTOPLY_TEST === "1";
}

export function isLocalOrigin(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]");
  } catch {
    return false;
  }
}

export function assertSubmitAllowed(url: string, env: NodeJS.ProcessEnv = process.env): void {
  if (isTestEnvironment(env) && !isLocalOrigin(url)) throw new SubmitBlockedError(url);
}

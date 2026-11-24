/** Politeness helpers for discovery: per-domain spacing and retry with backoff. */

export type Sleep = (ms: number) => Promise<void>;
export type Clock = () => number;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    /** Parsed Retry-After header, in milliseconds. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

export type RateLimiterOptions = {
  /** Minimum gap between requests to the same domain. */
  minIntervalMs: number;
  now?: Clock;
  sleep?: Sleep;
};

/** Spaces requests to each domain at least `minIntervalMs` apart. Safe under concurrent callers. */
export class RateLimiter {
  private readonly nextSlot = new Map<string, number>();
  private readonly now: Clock;
  private readonly sleep: Sleep;
  private readonly minIntervalMs: number;

  constructor(opts: RateLimiterOptions) {
    this.minIntervalMs = opts.minIntervalMs;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
  }

  async acquire(url: string): Promise<void> {
    let domain: string;
    try {
      domain = new URL(url).hostname.toLowerCase();
    } catch {
      domain = url;
    }
    const now = this.now();
    const slot = Math.max(now, this.nextSlot.get(domain) ?? 0);
    // Reserve synchronously so concurrent callers queue behind each other.
    this.nextSlot.set(domain, slot + this.minIntervalMs);
    const wait = slot - now;
    if (wait > 0) await this.sleep(wait);
  }
}

export type BackoffOptions = {
  retries: number;
  baseMs: number;
  maxMs: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  sleep?: Sleep;
  /** Returns [0, 1). Injectable for tests. */
  random?: () => number;
};

/** Retry on network errors, 429 and 5xx; never on other 4xx. */
export function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return true;
}

export async function withBackoff<T>(fn: (attempt: number) => Promise<T>, opts: BackoffOptions): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  const random = opts.random ?? Math.random;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.retries || !shouldRetry(err, attempt)) throw err;
      const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** attempt);
      // Full jitter on the upper half: [exp/2, exp).
      const jittered = Math.round(exp / 2 + (random() * exp) / 2);
      const retryAfter = err instanceof HttpError ? err.retryAfterMs : null;
      await sleep(retryAfter !== null ? Math.max(retryAfter, jittered) : jittered);
    }
  }
}

export type FetchJsonOptions = {
  fetch?: typeof fetch;
  limiter?: RateLimiter;
  backoff?: Partial<BackoffOptions>;
};

export async function fetchJson(url: string, opts: FetchJsonOptions = {}): Promise<unknown> {
  const doFetch = opts.fetch ?? fetch;
  return withBackoff(
    async () => {
      await opts.limiter?.acquire(url);
      const res = await doFetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new HttpError(res.status, url, parseRetryAfter(res.headers.get("retry-after")));
      return (await res.json()) as unknown;
    },
    { retries: 2, baseMs: 500, maxMs: 15_000, ...opts.backoff },
  );
}

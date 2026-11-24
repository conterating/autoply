import { fetchJson, type FetchJsonOptions } from "./polite.ts";

export type DiscoveryOptions = FetchJsonOptions & {
  /** Override the API origin (tests point this at a fixture server). */
  baseUrl?: string;
  /** Path prefix inserted before the API path. Defaults to the fixture prefix when `baseUrl` is set, "" otherwise. */
  pathPrefix?: string;
};

export type BoardRef = { boardToken: string; companyName: string };

export function resolveUrl(opts: DiscoveryOptions, realBase: string, fixturePrefix: string, path: string): string {
  const base = (opts.baseUrl ?? realBase).replace(/\/+$/, "");
  const prefix = opts.pathPrefix ?? (opts.baseUrl ? fixturePrefix : "");
  return `${base}${prefix}${path}`;
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1]!.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

/** HTML to readable plain text: block tags become newlines, list items get dashes. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<br\s*\/?>|<\/(p|div|li|ul|ol|h[1-6]|tr|section)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type WorkplaceType = "remote" | "hybrid" | "onsite" | "unknown";

export function workplaceFromText(text: string): WorkplaceType {
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  if (/\bremote\b/i.test(text)) return "remote";
  return "unknown";
}

export function fetchJsonFor(url: string, opts: DiscoveryOptions): Promise<unknown> {
  return fetchJson(url, opts);
}

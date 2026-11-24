import { decodeEntities } from "./common.ts";

export type CommunityPosting = {
  company: string;
  title: string;
  location: string;
  applyUrl: string;
  ats: "greenhouse" | "lever" | "ashby";
  boardToken: string;
  externalId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Infers the ATS, board and posting id from a public job URL, or null for unsupported hosts. */
export function inferFromUrl(raw: string): Pick<CommunityPosting, "ats" | "boardToken" | "externalId"> | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const seg = url.pathname.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });

  if (host === "greenhouse.io" || host.endsWith(".greenhouse.io")) {
    if (!/^(boards|job-boards)(\.[a-z]+)?\.greenhouse\.io$/.test(host)) return null;
    if (seg[0] === "embed") {
      const token = url.searchParams.get("for");
      const id = url.searchParams.get("token");
      return token && id && /^\d+$/.test(id) ? { ats: "greenhouse", boardToken: token, externalId: id } : null;
    }
    if (seg.length >= 3 && seg[1] === "jobs" && /^\d+$/.test(seg[2]!)) {
      return { ats: "greenhouse", boardToken: seg[0]!, externalId: seg[2]! };
    }
    return null;
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    if (seg.length >= 2 && UUID.test(seg[1]!)) return { ats: "lever", boardToken: seg[0]!, externalId: seg[1]!.toLowerCase() };
    return null;
  }
  if (host === "jobs.ashbyhq.com") {
    if (seg.length >= 2 && UUID.test(seg[1]!)) return { ats: "ashby", boardToken: seg[0]!, externalId: seg[1]!.toLowerCase() };
    return null;
  }
  return null;
}

function clean(cell: string): string {
  return decodeEntities(
    cell
      .replace(/<summary[\s\S]*?<\/summary>/gi, "")
      .replace(/<br\s*\/?>/gi, "; ")
      .replace(/<[^>]+>/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]{1,3}/g, ""),
  )
    .replace(/🔒|🛂|🇺🇸|🎓|🔥/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/(;\s*)+$/, "")
    .trim();
}

function urlsIn(cell: string): string[] {
  const urls: string[] = [];
  for (const m of cell.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) urls.push(decodeEntities(m[1]!));
  for (const m of cell.matchAll(/\]\(\s*<?([^)\s>]+)/g)) urls.push(m[1]!);
  for (const m of cell.matchAll(/https?:\/\/[^\s)"'<>\]]+/g)) urls.push(m[0]);
  return urls;
}

function splitMarkdownRow(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  const cells: string[] = [];
  let cur = "";
  let depth = 0; // ignore pipes inside <...> tags and [..](..) links
  for (let i = 1; i < t.length; i++) {
    const ch = t[i]!;
    if (ch === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "<") depth++;
    if (ch === ">" && depth > 0) depth--;
    if (ch === "|" && depth === 0) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) cells.push(cur);
  return cells;
}

function htmlRows(markdown: string): string[][] {
  const rows: string[][] = [];
  for (const tr of markdown.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1]!);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/**
 * Parses a SimplifyJobs-style README table (markdown pipe rows and/or HTML
 * `<tr>` rows): Company | Role | Location | Application | Age. `↳` repeats the
 * previous company; closed (🔒) rows and links to unsupported ATSes are dropped.
 */
export function parseCommunityList(markdown: string): CommunityPosting[] {
  const rows: string[][] = [];
  const withoutHtmlTables = markdown.replace(/<table\b[\s\S]*?<\/table>/gi, "");
  for (const line of withoutHtmlTables.split(/\r?\n/)) {
    const cells = splitMarkdownRow(line);
    if (cells) rows.push(cells);
  }
  rows.push(...htmlRows(markdown));

  const out: CommunityPosting[] = [];
  const seen = new Set<string>();
  let previousCompany = "";
  for (const cells of rows) {
    if (cells.length < 4) continue;
    if (cells.every((c) => /^[\s:-]*$/.test(c))) continue; // separator
    const first = clean(cells[0]!);
    if (/^company$/i.test(first)) continue; // header

    const company = first === "↳" || first === "" ? previousCompany : first;
    if (!company) continue;
    previousCompany = company;

    const title = clean(cells[1]!);
    const location = clean(cells[2]!);
    if (!title) continue;
    if (cells.slice(0, 4).some((c) => c.includes("🔒"))) continue;

    const candidates = [...urlsIn(cells[3]!), ...cells.slice(4).flatMap(urlsIn)];
    for (const applyUrl of candidates) {
      const inferred = inferFromUrl(applyUrl);
      if (!inferred) continue;
      const key = `${inferred.ats}:${inferred.externalId}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ company, title, location, applyUrl, ...inferred });
      }
      break;
    }
  }
  return out;
}

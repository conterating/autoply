import { describe, expect, it, vi } from "vitest";
import { ashby, dedupeKey, fetchSource, greenhouse, lever } from "../src/discovery/index.ts";
import { parseCommunityList } from "../src/discovery/community.ts";
import { HttpError, RateLimiter, withBackoff } from "../src/discovery/polite.ts";

function jsonFetch(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify(body), { status, headers }));
}
const asFetch = (f: unknown) => f as typeof fetch;
const noRetry = { backoff: { retries: 0 } };

describe("greenhouse", () => {
  const body = {
    jobs: [
      {
        id: 127817,
        internal_job_id: 144381,
        title: "Vault Designer",
        updated_at: "2016-01-14T10:55:28-05:00",
        requisition_id: "50",
        location: { name: "NYC (Hybrid)" },
        absolute_url: "https://boards.greenhouse.io/vaulttec/jobs/127817",
        language: "en",
        metadata: null,
        content: "&lt;p&gt;Design &amp;amp; build &lt;strong&gt;vaults&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;CAD&lt;/li&gt;&lt;/ul&gt;",
        departments: [],
        offices: [],
      },
      { id: 2, title: "Remote Welder", location: { name: "Remote - US" }, absolute_url: "https://boards.greenhouse.io/vaulttec/jobs/2", content: "" },
      { id: 3, location: { name: "Nowhere" } },
    ],
    meta: { total: 3 },
  };

  it("normalizes, decodes entities, strips tags and skips malformed jobs", async () => {
    const f = jsonFetch(body);
    const out = await greenhouse.fetchBoard({ boardToken: "vaulttec", companyName: "Vault Tec" }, { baseUrl: "http://fx", fetch: asFetch(f), ...noRetry });
    expect(f.mock.calls[0]![0]).toBe("http://fx/greenhouse/boards-api/v1/boards/vaulttec/jobs?content=true");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      ats: "greenhouse",
      externalId: "127817",
      company: "Vault Tec",
      title: "Vault Designer",
      location: "NYC (Hybrid)",
      workplaceType: "hybrid",
      applyUrl: "https://boards.greenhouse.io/vaulttec/jobs/127817",
      postedAt: "2016-01-14T10:55:28-05:00",
    });
    expect(out[0]!.description).toBe("Design & build vaults\n\n- CAD");
    expect(out[0]!.raw).toBeDefined();
    expect(out[1]!.workplaceType).toBe("remote");
  });

  it("uses the real API without a prefix by default", async () => {
    const f = jsonFetch({ jobs: [] });
    await greenhouse.fetchBoard({ boardToken: "x", companyName: "X" }, { fetch: asFetch(f) });
    expect(f.mock.calls[0]![0]).toBe("https://boards-api.greenhouse.io/v1/boards/x/jobs?content=true");
  });
});

describe("lever", () => {
  const body = [
    {
      id: "5ac21346-8e0c-4494-8e7a-3eb92ff77902",
      text: "Example Job",
      categories: { location: "San Francisco", commitment: "Full-time", team: "Eng", department: "R&D", allLocations: ["San Francisco"] },
      country: "US",
      descriptionPlain: "Do things.",
      additionalPlain: "Perks.",
      lists: [{ text: "Requirements", content: "<li>TypeScript</li><li>SQL</li>" }],
      hostedUrl: "https://jobs.lever.co/leverdemo/5ac21346-8e0c-4494-8e7a-3eb92ff77902",
      applyUrl: "https://jobs.lever.co/leverdemo/5ac21346-8e0c-4494-8e7a-3eb92ff77902/apply",
      workplaceType: "on-site",
      salaryRange: { currency: "USD", interval: "per-year-salary", min: 100000, max: 140000 },
    },
    { id: "b", text: "Remote one", categories: { location: "Anywhere" }, hostedUrl: "https://jobs.lever.co/x/b", workplaceType: "remote" },
    { id: "c", text: "Unspecified", categories: { location: "Remote (US)" }, hostedUrl: "https://jobs.lever.co/x/c", workplaceType: "unspecified" },
    { text: "no id", hostedUrl: "https://jobs.lever.co/x/d" },
  ];

  it("normalizes workplace types and drops malformed entries", async () => {
    const f = jsonFetch(body);
    const out = await lever.fetchBoard({ boardToken: "leverdemo", companyName: "Lever Demo" }, { baseUrl: "http://fx", fetch: asFetch(f), ...noRetry });
    expect(f.mock.calls[0]![0]).toBe("http://fx/lever/v0/postings/leverdemo?mode=json");
    expect(out.map((p) => p.workplaceType)).toEqual(["onsite", "remote", "remote"]);
    expect(out[0]).toMatchObject({ ats: "lever", externalId: "5ac21346-8e0c-4494-8e7a-3eb92ff77902", postedAt: null, location: "San Francisco" });
    expect(out[0]!.applyUrl).toMatch(/\/apply$/);
    expect(out[0]!.description).toContain("Do things.");
    expect(out[0]!.description).toContain("- TypeScript");
    expect(out[0]!.description).toContain("Perks.");
    expect(out[1]!.applyUrl).toBe("https://jobs.lever.co/x/b/apply");
  });
});

describe("ashby", () => {
  const uuid = "8d2ad9a5-2b5a-4d0c-9c37-0e9d6a8f4b11";
  const body = {
    apiVersion: "1",
    jobs: [
      {
        title: "Product Manager",
        location: "Houston, TX",
        department: "Product",
        team: "Growth",
        secondaryLocations: [],
        isListed: true,
        isRemote: true,
        workplaceType: "Remote",
        descriptionHtml: "<p>Join our team</p>",
        descriptionPlain: "Join our team",
        publishedAt: "2021-04-30T16:21:55.393+00:00",
        employmentType: "FullTime",
        address: { postalAddress: { addressLocality: "Houston", addressRegion: "Texas", addressCountry: "USA" } },
        jobUrl: `https://jobs.ashbyhq.com/example/${uuid}`,
        applyUrl: `https://jobs.ashbyhq.com/example/${uuid}/application`,
      },
      { title: "Hidden", location: "X", isListed: false, jobUrl: `https://jobs.ashbyhq.com/example/${uuid.replace("8d", "9d")}` },
      { title: "On site", location: "Austin", isListed: true, workplaceType: "OnSite", descriptionHtml: "<p>Hi &amp; bye</p>", jobUrl: `https://jobs.ashbyhq.com/example/${uuid.replace("8d", "7d")}` },
      { location: "no title" },
    ],
  };

  it("derives id from jobUrl, skips unlisted and malformed", async () => {
    const f = jsonFetch(body);
    const out = await ashby.fetchBoard({ boardToken: "example", companyName: "Example" }, { baseUrl: "http://fx", fetch: asFetch(f), ...noRetry });
    expect(f.mock.calls[0]![0]).toBe("http://fx/ashby/posting-api/job-board/example?includeCompensation=true");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      ats: "ashby",
      externalId: uuid,
      workplaceType: "remote",
      postedAt: "2021-04-30T16:21:55.393+00:00",
      applyUrl: `https://jobs.ashbyhq.com/example/${uuid}/application`,
      description: "Join our team",
    });
    expect(out[1]).toMatchObject({ workplaceType: "onsite", description: "Hi & bye" });
  });

  it("dispatches through fetchSource and rejects unknown ATSes", async () => {
    const f = jsonFetch(body);
    const out = await fetchSource("ashby", { boardToken: "example", companyName: "E" }, { baseUrl: "http://fx", fetch: asFetch(f) });
    expect(out).toHaveLength(2);
    await expect(fetchSource("workday", { boardToken: "x", companyName: "X" })).rejects.toThrow(/No discovery client/);
  });
});

describe("dedupeKey", () => {
  it("normalizes case, punctuation and whitespace", () => {
    expect(dedupeKey("Acme, Inc.", "Software  Engineer (Backend)", "San Francisco, CA")).toBe(
      "acme inc|software engineer backend|san francisco ca",
    );
  });
  it("collapses remote location variants", () => {
    const a = dedupeKey("A", "T", "Remote - US");
    expect(dedupeKey("A", "T", "Remote (US)")).toBe(a);
    expect(dedupeKey("A", "T", "Remote, United States")).toBe(a);
    expect(dedupeKey("A", "T", "REMOTE – U.S.")).toBe(a);
  });
  it("keeps genuinely different jobs distinct", () => {
    expect(dedupeKey("A", "T", "Remote - US")).not.toBe(dedupeKey("A", "T", "Remote - Canada"));
    expect(dedupeKey("A", "Senior Engineer", "NYC")).not.toBe(dedupeKey("A", "Engineer", "NYC"));
    expect(dedupeKey("A", "T", "NYC")).not.toBe(dedupeKey("B", "T", "NYC"));
  });
  it("strips diacritics", () => {
    expect(dedupeKey("Café", "Ingénieur", "Zürich")).toBe("cafe|ingenieur|zurich");
  });
});

describe("RateLimiter", () => {
  it("spaces requests per domain and does not delay other domains", async () => {
    let t = 1000;
    const sleeps: number[] = [];
    const limiter = new RateLimiter({
      minIntervalMs: 500,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    await limiter.acquire("https://a.example/x");
    await limiter.acquire("https://a.example/y");
    await limiter.acquire("https://a.example/z");
    await limiter.acquire("https://b.example/x");
    expect(sleeps).toEqual([500, 500]);
    t += 10_000;
    await limiter.acquire("https://a.example/later");
    expect(sleeps).toEqual([500, 500]);
  });

  it("queues concurrent callers", async () => {
    const t = 0;
    const sleeps: number[] = [];
    const limiter = new RateLimiter({ minIntervalMs: 100, now: () => t, sleep: async (ms) => void sleeps.push(ms) });
    await Promise.all([limiter.acquire("https://a.example"), limiter.acquire("https://a.example"), limiter.acquire("https://a.example")]);
    expect(sleeps).toEqual([100, 200]);
  });
});

describe("withBackoff", () => {
  const opts = (sleeps: number[]) => ({
    retries: 3,
    baseMs: 100,
    maxMs: 1000,
    random: () => 0,
    sleep: async (ms: number) => void sleeps.push(ms),
  });

  it("retries 5xx with exponential delays then succeeds", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const result = await withBackoff(async () => {
      if (++n < 3) throw new HttpError(503, "u");
      return "ok";
    }, opts(sleeps));
    expect(result).toBe("ok");
    expect(sleeps).toEqual([50, 100]);
  });

  it("honors Retry-After on 429", async () => {
    const sleeps: number[] = [];
    let n = 0;
    await withBackoff(async () => {
      if (++n < 2) throw new HttpError(429, "u", 7000);
      return 1;
    }, opts(sleeps));
    expect(sleeps).toEqual([7000]);
  });

  it("retries network errors", async () => {
    const sleeps: number[] = [];
    let n = 0;
    await withBackoff(async () => {
      if (++n < 2) throw new TypeError("fetch failed");
      return 1;
    }, opts(sleeps));
    expect(sleeps).toHaveLength(1);
  });

  it("does not retry 404 and gives up after the retry budget", async () => {
    const sleeps: number[] = [];
    let n = 0;
    await expect(withBackoff(async () => { n++; throw new HttpError(404, "u"); }, opts(sleeps))).rejects.toThrow(/404/);
    expect(n).toBe(1);
    expect(sleeps).toEqual([]);
    n = 0;
    await expect(withBackoff(async () => { n++; throw new HttpError(500, "u"); }, opts(sleeps))).rejects.toThrow(/500/);
    expect(n).toBe(4);
  });

  it("fetchBoard surfaces 404 without retrying and reads Retry-After from the response", async () => {
    const f404 = jsonFetch({}, 404);
    await expect(greenhouse.fetchBoard({ boardToken: "x", companyName: "X" }, { fetch: asFetch(f404) })).rejects.toBeInstanceOf(HttpError);
    expect(f404).toHaveBeenCalledTimes(1);

    const sleeps: number[] = [];
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? new Response("", { status: 429, headers: { "retry-after": "2" } }) : new Response(JSON.stringify({ jobs: [] }))));
    await greenhouse.fetchBoard(
      { boardToken: "x", companyName: "X" },
      { fetch: asFetch(f), backoff: { baseMs: 10, maxMs: 10, sleep: async (ms) => void sleeps.push(ms) } },
    );
    expect(sleeps).toEqual([2000]);
  });
});

describe("parseCommunityList", () => {
  const md = `
# New Grad Positions

| Company | Role | Location | Application/Link | Date Posted |
| ------- | ---- | -------- | ---------------- | ----------- |
| **[Stripe](https://stripe.com)** | Software Engineer, New Grad | San Francisco, CA | <a href="https://boards.greenhouse.io/stripe/jobs/12345?gh_src=x"><img src="https://i.imgur.com/apply.png" width="118" alt="Apply"></a> | 0d |
| ↳ | Backend Engineer | Remote | <a href="https://jobs.lever.co/stripe/5ac21346-8e0c-4494-8e7a-3eb92ff77902/apply"><img alt="Apply"></a> | 1d |
| **[Closed Co](https://closed.example)** | Old Role 🔒 | NYC | <a href="https://boards.greenhouse.io/closed/jobs/9"><img alt="Apply"></a> | 9d |
| Workday Co | Engineer | NYC | <a href="https://acme.wd1.myworkdayjobs.com/en-US/careers/job/x"><img alt="Apply"></a> | 2d |
| Ashby Co | ML Engineer | Austin, TX | [Apply](https://jobs.ashbyhq.com/ashbyco/8d2ad9a5-2b5a-4d0c-9c37-0e9d6a8f4b11/application) | 3d |
| Ghost | Unlinked | NYC | 🔒 | 3d |
`;
  it("parses markdown pipe rows", () => {
    const rows = parseCommunityList(md);
    expect(rows.map((r) => [r.company, r.title, r.ats, r.boardToken, r.externalId])).toEqual([
      ["Stripe", "Software Engineer, New Grad", "greenhouse", "stripe", "12345"],
      ["Stripe", "Backend Engineer", "lever", "stripe", "5ac21346-8e0c-4494-8e7a-3eb92ff77902"],
      ["Ashby Co", "ML Engineer", "ashby", "ashbyco", "8d2ad9a5-2b5a-4d0c-9c37-0e9d6a8f4b11"],
    ]);
    expect(rows[0]!.location).toBe("San Francisco, CA");
    expect(rows[0]!.applyUrl).toBe("https://boards.greenhouse.io/stripe/jobs/12345?gh_src=x");
  });

  const html = `
<table>
<thead><tr><th>Company</th><th>Role</th><th>Location</th><th>Application</th><th>Age</th></tr></thead>
<tbody>
<tr>
  <td><strong><a href="https://example.com">Acme</a></strong></td>
  <td>Software Engineer Intern</td>
  <td><details><summary><strong>2 locations</strong></summary>NYC<br>Remote in USA</details></td>
  <td><div align="center"><a href="https://job-boards.greenhouse.io/acme/jobs/777"><img src="x.png" alt="Apply"></a></div></td>
  <td>0d</td>
</tr>
<tr>
  <td>↳</td><td>Data Intern</td><td>Boston, MA</td>
  <td><a href="https://jobs.ashbyhq.com/acme/7d2ad9a5-2b5a-4d0c-9c37-0e9d6a8f4b11">Apply</a></td><td>2d</td>
</tr>
<tr><td>Done</td><td>Closed Role</td><td>LA</td><td>🔒</td><td>30d</td></tr>
<tr><td>Other</td><td>Dev</td><td>LA</td><td><a href="https://www.linkedin.com/jobs/view/1">Apply</a></td><td>1d</td></tr>
</tbody></table>`;
  it("parses HTML table rows", () => {
    const rows = parseCommunityList(html);
    expect(rows.map((r) => [r.company, r.title, r.location, r.ats, r.externalId])).toEqual([
      ["Acme", "Software Engineer Intern", "NYC; Remote in USA", "greenhouse", "777"],
      ["Acme", "Data Intern", "Boston, MA", "ashby", "7d2ad9a5-2b5a-4d0c-9c37-0e9d6a8f4b11"],
    ]);
  });

  it("handles a continuation row after a dropped row", () => {
    const rows = parseCommunityList(`
| Company | Role | Location | Link | Age |
|---|---|---|---|---|
| Foo | A | NYC | https://example.com/a | 1d |
| ↳ | B | NYC | https://boards.greenhouse.io/foo/jobs/1 | 1d |
`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.company).toBe("Foo");
  });
});

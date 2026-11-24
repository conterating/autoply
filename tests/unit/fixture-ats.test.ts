import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_BOARDS, startFixtureServer } from "../fixtures/ats/src/index.ts";

type Server = Awaited<ReturnType<typeof startFixtureServer>>;
let srv: Server;

beforeAll(async () => {
  srv = await startFixtureServer({ port: 0 });
});
afterAll(async () => {
  await srv.close();
});
beforeEach(() => srv.reset());

const gh = FIXTURE_BOARDS.greenhouse;
const lv = FIXTURE_BOARDS.lever;
const ab = FIXTURE_BOARDS.ashby;
const getText = async (path: string) => {
  const r = await fetch(srv.url + path);
  return { status: r.status, text: await r.text() };
};
const post = (path: string, fd: FormData) => fetch(srv.url + path, { method: "POST", body: fd });
const resumeFile = () => new File(["%PDF-1.4 fake resume bytes"], "resume.pdf", { type: "application/pdf" });

describe("discovery", () => {
  it("greenhouse shape", async () => {
    const r = await fetch(`${srv.url}/greenhouse/boards-api/v1/boards/northwind/jobs?content=true`);
    const body = (await r.json()) as { jobs: Record<string, unknown>[]; meta: { total: number } };
    expect(body.meta.total).toBe(body.jobs.length);
    expect(body.jobs.length).toBe(gh.postings.filter((p) => !p.closed).length);
    const job = body.jobs[0]!;
    expect(typeof job.id).toBe("number");
    expect(job.absolute_url).toBe(`${srv.url}/greenhouse/northwind/jobs/${gh.postings[0]!.id}`);
    expect(String(job.content)).toContain("&lt;p&gt;");
    expect(job.location).toEqual({ name: expect.any(String) });
    const q = (await (await fetch(`${srv.url}/greenhouse/boards-api/v1/boards/northwind/jobs/${gh.postings[0]!.id}?questions=true`)).json()) as {
      questions: unknown[];
      demographic_questions: { questions: unknown[] };
    };
    expect(q.questions.length).toBeGreaterThan(5);
    expect(q.demographic_questions.questions).toHaveLength(4);
  });

  it("lever shape", async () => {
    const r = await fetch(`${srv.url}/lever/v0/postings/contoso?mode=json`);
    const body = (await r.json()) as Record<string, unknown>[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(lv.postings.filter((p) => !p.closed).length);
    const p = body[0]!;
    expect(p.hostedUrl).toContain(`${srv.url}/lever/contoso/`);
    expect(String(p.applyUrl)).toMatch(/\/apply$/);
    expect(["remote", "hybrid", "on-site"]).toContain(p.workplaceType);
    expect(p.categories).toHaveProperty("location");
    expect(typeof p.descriptionPlain).toBe("string");
    expect(p.country).toBe("US");
  });

  it("ashby shape", async () => {
    const r = await fetch(`${srv.url}/ashby/posting-api/job-board/fabrikam?includeCompensation=true`);
    const body = (await r.json()) as { apiVersion: string; jobs: Record<string, unknown>[] };
    expect(body.apiVersion).toBe("1");
    expect(body.jobs.length).toBe(ab.postings.length);
    const j = body.jobs[0]!;
    expect(String(j.jobUrl)).toMatch(/\/[0-9a-f-]{36}$/);
    expect(String(j.applyUrl)).toBe(`${j.jobUrl}/application`);
    expect(["OnSite", "Remote", "Hybrid"]).toContain(j.workplaceType);
    expect(j.isListed).toBe(true);
    expect(j).toHaveProperty("compensation");
  });

  it("closed postings are omitted from discovery", async () => {
    const g = (await (await fetch(`${srv.url}/greenhouse/boards-api/v1/boards/northwind/jobs`)).json()) as { jobs: { id: number }[] };
    expect(g.jobs.map((j) => String(j.id))).not.toContain(gh.variants.closed);
    const l = (await (await fetch(`${srv.url}/lever/v0/postings/contoso`)).json()) as { id: string }[];
    expect(l.map((j) => j.id)).not.toContain(lv.variants.closed);
  });
});

describe("form pages", () => {
  it("greenhouse renders labeled fields and comboboxes", async () => {
    const { status, text } = await getText(`/greenhouse/northwind/jobs/${gh.postings[0]!.id}`);
    expect(status).toBe(200);
    expect(text).toContain('<form id="application-form"');
    for (const id of ["first_name", "last_name", "email", "phone", "country", "resume", "cover_letter"]) {
      expect(text).toContain(`id="${id}"`);
      expect(text).toContain(`for="${id}"`);
    }
    expect(text).toContain('<input type="file" id="resume"');
    expect(text).toContain('role="combobox"');
    expect(text).toContain("aria-expanded");
    expect(text).toContain("aria-controls");
    expect(text).toContain("Decline To Self Identify");
    expect(text).toContain("I am not a protected veteran");
    expect(text).toContain("Submit application");
  });

  it("lever posting page links to apply and form has expected names", async () => {
    const id = lv.postings[0]!.id;
    const page = await getText(`/lever/contoso/${id}`);
    expect(page.text).toContain("Apply for this job");
    const { status, text } = await getText(`/lever/contoso/${id}/apply`);
    expect(status).toBe(200);
    for (const name of ["name", "email", "phone", "org", "urls[LinkedIn]", "urls[GitHub]", "urls[Portfolio]", "resume", "comments", "eeo[gender]", "eeo[race]", "eeo[veteran]"]) {
      expect(text).toContain(`name="${name}"`);
    }
    expect(text).toMatch(/name="cards\[[0-9a-f-]+\]\[field0\]"/);
    expect(text).not.toContain('class="h-captcha"');
  });

  it("ashby renders system fields and yes/no buttons", async () => {
    const { status, text } = await getText(`/ashby/fabrikam/${ab.postings[0]!.id}/application`);
    expect(status).toBe(200);
    for (const id of ["_systemfield_name", "_systemfield_email", "_systemfield_phone", "_systemfield_resume"]) expect(text).toContain(`id="${id}"`);
    expect(text).toContain('<button type="button" id="5d0a1c00-0000-4000-8000-000000000002-yes"');
    expect(text).toContain("Submit Application");
    expect(text).toContain("Why do you want to work here?");
    expect(text).not.toContain('id="next-btn"');
  });

  it("variant pages: conditional, captcha, multipage", async () => {
    const g = await getText(`/greenhouse/northwind/jobs/${gh.variants.conditionalSponsorship}`);
    expect(g.text).toContain("What visa type will you need?");
    const c = await getText(`/lever/contoso/${lv.variants.captcha}/apply`);
    expect(c.text).toContain('class="h-captcha" data-sitekey="fixture"');
    expect(c.text).toContain('title="hCaptcha challenge"');
    const m = await getText(`/ashby/fabrikam/${ab.variants.multiPage}/application`);
    expect(m.text).toContain('id="next-btn"');
  });
});

describe("submissions", () => {
  it("records a multipart greenhouse submission with a file", async () => {
    const fd = new FormData();
    fd.set("first_name", "Ada");
    fd.set("last_name", "Lovelace");
    fd.set("email", "ada@example.com");
    fd.set("phone", "555-0100");
    fd.set("country", "United States");
    fd.set("gender", "Decline To Self Identify");
    fd.set("question_40100003", "Yes");
    fd.set("question_40100004", "No");
    fd.set("resume", resumeFile());
    const r = await post(`/greenhouse/northwind/jobs/${gh.postings[0]!.id}`, fd);
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(text).toContain("Thank you for applying");
    expect(text).toContain(gh.postings[0]!.title);
    const subs = srv.submissions();
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ ats: "greenhouse", board: "northwind", jobId: gh.postings[0]!.id });
    expect(subs[0]!.fields).toMatchObject({ first_name: "Ada", email: "ada@example.com", gender: "Decline To Self Identify" });
    expect(subs[0]!.files.resume).toEqual({ filename: "resume.pdf", size: 26, contentType: "application/pdf" });
    expect(text).toContain(subs[0]!.id);
    const viaApi = (await (await fetch(`${srv.url}/__submissions`)).json()) as unknown[];
    expect(viaApi).toHaveLength(1);
    await fetch(`${srv.url}/__reset`, { method: "POST" });
    expect(srv.submissions()).toHaveLength(0);
  });

  it("records lever submissions with repeated checkbox values", async () => {
    const fd = new FormData();
    fd.set("name", "Ada Lovelace");
    fd.set("email", "ada@example.com");
    fd.set("resume", resumeFile());
    const card = /name="(cards\[[0-9a-f-]+\]\[field0\])"/g;
    const page = await (await fetch(`${srv.url}/lever/contoso/${lv.postings[0]!.id}/apply`)).text();
    const names = [...new Set([...page.matchAll(card)].map((m) => m[1]!))];
    for (const n of names) fd.set(n, "Yes");
    fd.append(names[names.length - 2]!, "Go");
    const r = await post(`/lever/contoso/${lv.postings[0]!.id}/apply`, fd);
    expect(await r.text()).toContain("Application submitted!");
    expect(srv.submissions()[0]!.fields.name).toBe("Ada Lovelace");
  });

  it("records urlencoded ashby submissions only when resume present (urlencoded has none)", async () => {
    const body = new URLSearchParams({ _systemfield_name: "Ada", _systemfield_email: "a@b.co" });
    const r = await fetch(`${srv.url}/ashby/fabrikam/${ab.postings[0]!.id}/application`, { method: "POST", body });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("Resume is required");
    expect(srv.submissions()).toHaveLength(0);
  });

  it("rejects missing resume on all three ATS", async () => {
    const gfd = new FormData();
    gfd.set("first_name", "Ada");
    gfd.set("resume", new File([], ""));
    const g = await post(`/greenhouse/northwind/jobs/${gh.postings[0]!.id}`, gfd);
    expect(g.status).toBe(400);
    expect(await g.text()).toContain("Resume is required");
    const lfd = new FormData();
    lfd.set("name", "Ada");
    const l = await post(`/lever/contoso/${lv.postings[0]!.id}/apply`, lfd);
    expect(await l.text()).toContain("Resume is required");
    expect(srv.submissions()).toHaveLength(0);
  });

  it("greenhouse error variant returns 500 and records nothing", async () => {
    const fd = new FormData();
    fd.set("first_name", "Ada");
    fd.set("resume", resumeFile());
    const r = await post(`/greenhouse/northwind/jobs/${gh.variants.serverError}`, fd);
    expect(r.status).toBe(500);
    expect(await r.text()).toContain("Something went wrong. Please try again.");
    expect(srv.submissions()).toHaveLength(0);
  });

  it("captcha variant never accepts a submission", async () => {
    const fd = new FormData();
    fd.set("name", "Ada");
    fd.set("email", "a@b.co");
    fd.set("resume", resumeFile());
    const r = await post(`/lever/contoso/${lv.variants.captcha}/apply`, fd);
    expect(await r.text()).toContain("Please complete the captcha");
    expect(srv.submissions()).toHaveLength(0);
  });

  it("conditional visa field is required server-side when sponsorship is Yes", async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ first_name: "A", last_name: "B", email: "a@b.co", country: "India", phone: "1", question_40100003: "Yes", question_40100004: "Yes" })) fd.set(k, v);
    fd.set("resume", resumeFile());
    const r = await post(`/greenhouse/northwind/jobs/${gh.variants.conditionalSponsorship}`, fd);
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("What visa type will you need? is required");
    fd.set("question_40100005", "F-1 OPT");
    const ok = await post(`/greenhouse/northwind/jobs/${gh.variants.conditionalSponsorship}`, fd);
    expect(ok.status).toBe(200);
  });
});

describe("closed postings", () => {
  it("greenhouse closed form 404s", async () => {
    const { status, text } = await getText(`/greenhouse/northwind/jobs/${gh.variants.closed}`);
    expect(status).toBe(404);
    expect(text).toContain("This job is no longer accepting applications");
  });
  it("lever closed posting 404s", async () => {
    const { status, text } = await getText(`/lever/contoso/${lv.variants.closed}/apply`);
    expect(status).toBe(404);
    expect(text).toContain("This posting is closed");
  });
});

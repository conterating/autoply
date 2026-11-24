import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_BOARDS, startFixtureServer } from "../fixtures/ats/src/index.ts";
import { WORKDAY_PAGES, workdayPostingPath } from "../fixtures/ats/src/workday.ts";

type Server = Awaited<ReturnType<typeof startFixtureServer>>;
let srv: Server;

beforeAll(async () => {
  srv = await startFixtureServer({ port: 0 });
});
afterAll(async () => {
  await srv.close();
});
beforeEach(() => srv.reset());

const wd = FIXTURE_BOARDS.workday;
const [PLAIN, , VERIFY, CLOSED] = wd.postings as [(typeof wd.postings)[number], ...(typeof wd.postings)[number][]];
const P = "/workday/woodgrove/External";
const PASSWORD = "Str0ng!Passw0rd#1";

/** Minimal cookie-keeping client (redirects are followed by hand so tests can see them). */
function client() {
  let cookie = "";
  async function req(path: string, init: { method?: string; body?: FormData | URLSearchParams } = {}) {
    const r = await fetch(srv.url + path, { ...init, redirect: "manual", headers: cookie ? { cookie } : {} });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    return { status: r.status, location: r.headers.get("location"), text: await r.text() };
  }
  return {
    get: (path: string) => req(path),
    post: (path: string, fields: Record<string, string>, files: Record<string, File> = {}) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      for (const [k, v] of Object.entries(files)) fd.append(k, v);
      return req(path, { method: "POST", body: fd });
    },
  };
}
type Client = ReturnType<typeof client>;

const login = (id: string) => `${P}/login/${id}`;
const step = (id: string, slug: string) => `${P}/apply/${id}/${slug}`;

async function createAccount(c: Client, id = PLAIN.id, email = "jordan@example.com", password = PASSWORD) {
  return c.post(`${login(id)}?mode=create`, { email, password, verifyPassword: password, createAccountCheckbox: "true" });
}

const ANSWERS: Record<string, string>[] = [
  {
    "source--source": "Company Website",
    candidateIsPreviousWorker: "No",
    "legalName--firstName": "Jordan",
    "legalName--lastName": "Rivera",
    "address--addressLine1": "500 Congress Ave",
    "address--city": "Austin",
    "address--countryRegion": "Texas",
    "address--postalCode": "78701",
    "phone--deviceType": "Mobile",
    "phone--phoneNumber": "5125550142",
  },
  { linkedInAccount: "https://www.linkedin.com/in/jordanrivera" },
  { "q--workAuthorization": "Yes", "q--sponsorship": "No", "q--whyInterested": "I like building payment systems." },
  {
    "voluntary--gender": "I do not wish to self-identify",
    "voluntary--ethnicity": "I do not wish to answer",
    "voluntary--veteranStatus": "I am not a protected veteran",
    "termsAndConditions--acceptTermsAndAgreements": "true",
  },
  {
    "selfIdentifiedDisabilityData--name": "Jordan Rivera",
    "selfIdentifiedDisabilityData--dateSignedOn": "11/23/2026",
    "selfIdentifiedDisabilityData--disabilityStatus": "No, I do not have a disability and have not had one in the past",
  },
];
const resume = () => new File(["%PDF-1.4 fake resume"], "Jordan Rivera Resume.pdf", { type: "application/pdf" });

describe("workday fixture routes", () => {
  it("lists postings and renders a posting page with an Apply button", async () => {
    const c = client();
    expect((await c.get(P)).text).toContain(PLAIN.title);
    const path = workdayPostingPath(PLAIN);
    expect(path).toBe(`${P}/job/Austin-TX/Software-Engineer-New-Grad_R-10231`);
    const posting = await c.get(path);
    expect(posting.status).toBe(200);
    expect(posting.text).toContain('data-automation-id="adventureButton"');
    const choice = await c.get(`${path}/apply`);
    expect(choice.text).toContain("Apply Manually");
    expect(choice.text).toContain('data-automation-id="applyManually"');
    const manual = await c.get(`${path}/apply/applyManually`);
    expect(manual.status).toBe(303);
    expect(manual.location).toBe(login(PLAIN.id));
    const signin = await c.get(login(PLAIN.id));
    expect(signin.text).toContain('data-automation-id="signInSubmitButton"');
    expect((await c.get(`${login(PLAIN.id)}?mode=create`)).text).toContain('data-automation-id="verifyPassword"');
  });

  it("closed postings and unknown pages 404; the other ATS routes are untouched", async () => {
    const c = client();
    expect((await c.get(workdayPostingPath(CLOSED))).status).toBe(404);
    expect((await c.get(`${P}/job/Nowhere/Nothing_R-1`)).status).toBe(404);
    expect((await c.get("/workday/other/External")).status).toBe(404);
    expect((await c.get(P)).text).not.toContain(CLOSED.title);
  });

  it("requires sign-in before the application", async () => {
    const c = client();
    const r = await c.get(step(PLAIN.id, "myInformation"));
    expect(r.status).toBe(303);
    expect(r.location).toBe(login(PLAIN.id));
  });
});

describe("workday accounts", () => {
  it("validates account creation", async () => {
    const c = client();
    const weak = await c.post(`${login(PLAIN.id)}?mode=create`, { email: "a@b.co", password: "weak", verifyPassword: "other" });
    expect(weak.status).toBe(200);
    expect(weak.text).toContain('data-automation-id="errorMessage"');
    expect(weak.text).toContain("Password must be at least 8 characters");
    expect(weak.text).toContain("do not match");
    expect(weak.text).toContain("accept the terms");
  });

  it("creates an account, lands on My Information, then signs in later and rejects a wrong password", async () => {
    const c = client();
    const created = await createAccount(c);
    expect(created.status).toBe(303);
    expect(created.location).toBe(step(PLAIN.id, "myInformation"));
    const info = await c.get(created.location!);
    expect(info.text).toContain('data-automation-id="progressBarActiveStep"');
    expect(info.text).toContain("My Information");

    // A second account with the same email is refused.
    expect((await createAccount(client())).text).toContain("already exists");

    const fresh = client();
    const bad = await fresh.post(`${login(PLAIN.id)}?mode=signin`, { email: "jordan@example.com", password: "Wrong!Pass1" });
    expect(bad.status).toBe(200);
    expect(bad.text).toContain("incorrect");
    const ok = await fresh.post(`${login(PLAIN.id)}?mode=signin`, { email: "JORDAN@example.com", password: PASSWORD });
    expect(ok.status).toBe(303);
    expect(ok.location).toBe(step(PLAIN.id, "myInformation"));
  });

  it("the email-verification posting blocks sign-in until the account is verified", async () => {
    const c = client();
    const created = await createAccount(c, VERIFY.id, "v@example.com");
    expect(created.status).toBe(200);
    expect(created.text).toContain('data-automation-id="verifyEmailHeading"');
    const blocked = await c.post(`${login(PLAIN.id)}?mode=signin`, { email: "v@example.com", password: PASSWORD });
    expect(blocked.text).toContain("Verify Your Email Address");
    expect((await c.get(`/workday/__verify?email=v@example.com`)).status).toBe(200);
    const ok = await c.post(`${login(PLAIN.id)}?mode=signin`, { email: "v@example.com", password: PASSWORD });
    expect(ok.status).toBe(303);
  });
});

describe("workday application", () => {
  async function signedIn(): Promise<Client> {
    const c = client();
    await createAccount(c);
    return c;
  }

  it("shows errorMessage elements on an incomplete page and keeps the user there", async () => {
    const c = await signedIn();
    const r = await c.post(step(PLAIN.id, "myInformation"), { _action: "next", "legalName--firstName": "Jordan" });
    expect(r.status).toBe(200);
    expect(r.text).toContain('data-automation-id="errorMessage"');
    expect(r.text).toContain("The field Family Name is required and must have a value.");
    expect(r.text).toContain("The field How Did You Hear About Us is required and must have a value.");
    expect(r.text).toContain('value="Jordan"');
    expect((await c.get(step(PLAIN.id, "myExperience"))).location).toBe(step(PLAIN.id, "myInformation"));
    expect(srv.submissions()).toHaveLength(0);
  });

  it("walks every page and records the submission", async () => {
    const c = await signedIn();
    const files: Record<string, File>[] = [{}, { resume: resume() }, {}, {}, {}];
    for (const [i, answers] of ANSWERS.entries()) {
      const slug = WORKDAY_PAGES[i]!.slug;
      const r = await c.post(step(PLAIN.id, slug), { _action: "next", ...answers }, files[i]);
      expect(r.status, slug).toBe(303);
      expect(r.location).toBe(step(PLAIN.id, WORKDAY_PAGES[i + 1]!.slug));
    }
    const review = await c.get(step(PLAIN.id, "review"));
    expect(review.text).toContain("Jordan Rivera Resume.pdf");
    expect(review.text).toContain('data-automation-id="pageFooterSubmitButton"');
    const done = await c.post(step(PLAIN.id, "review"), { _action: "submit" });
    expect(done.location).toBe(step(PLAIN.id, "confirmation"));
    const conf = await c.get(done.location!);
    expect(conf.text).toContain("Application Submitted");
    expect(conf.text).toContain('data-testid="submission-id"');

    const [sub] = srv.submissions();
    expect(srv.submissions()).toHaveLength(1);
    expect(sub).toMatchObject({ ats: "workday", board: "woodgrove", jobId: PLAIN.id, id: "FX-0001" });
    expect(sub!.fields).toMatchObject({ ...Object.assign({}, ...ANSWERS), "account--email": "jordan@example.com" });
    expect(sub!.files.resume).toMatchObject({ filename: "Jordan Rivera Resume.pdf" });
    expect(conf.text).toContain(sub!.id);

    // Submitting again does not record a duplicate.
    await c.post(step(PLAIN.id, "review"), { _action: "submit" });
    expect(srv.submissions()).toHaveLength(1);
  });

  it("the Back button saves without validating, and pages can't be skipped", async () => {
    const c = await signedIn();
    expect((await c.get(step(PLAIN.id, "review"))).location).toBe(step(PLAIN.id, "myInformation"));
    await c.post(step(PLAIN.id, "myInformation"), { _action: "next", ...ANSWERS[0]! });
    const back = await c.post(step(PLAIN.id, "myExperience"), { _action: "back", linkedInAccount: "https://x.example/me" });
    expect(back.location).toBe(step(PLAIN.id, "myInformation"));
    expect((await c.get(step(PLAIN.id, "myExperience"))).text).toContain("https://x.example/me");
  });
});

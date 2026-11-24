import { type Ctx, type Reply, type Rule, fieldValue, validate } from "./core.ts";
import {
  AUTH_LABEL,
  FIXTURE_BOARDS,
  SPONSORSHIP_LABEL,
  VISA_LABEL,
  countryName,
  descriptionHtml,
  descriptionPlain,
  type Posting,
} from "./data.ts";
import { CONDITIONAL_JS, REQ, confirmationPage, errorBanner, esc, htmlReply, jsonReply, layout } from "./html.ts";

const board = FIXTURE_BOARDS.lever;

const CARD_AUTH = "a1b2c3d4-0001-4000-8000-000000000001";
const CARD_SPONSOR = "a1b2c3d4-0002-4000-8000-000000000002";
const CARD_VISA = "a1b2c3d4-0003-4000-8000-000000000003";
const CARD_LANGS = "a1b2c3d4-0004-4000-8000-000000000004";
const CARD_WHY = "a1b2c3d4-0005-4000-8000-000000000005";
const field0 = (id: string): string => `cards[${id}][field0]`;

export const LEVER_EEO = [
  { name: "eeo[gender]", id: "eeo-gender", label: "Gender", options: ["Male", "Female", "Decline to self-identify"] },
  {
    name: "eeo[race]",
    id: "eeo-race",
    label: "Race",
    options: [
      "Hispanic or Latino",
      "White (Not Hispanic or Latino)",
      "Black or African American (Not Hispanic or Latino)",
      "Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)",
      "Asian (Not Hispanic or Latino)",
      "American Indian or Alaska Native (Not Hispanic or Latino)",
      "Two or More Races (Not Hispanic or Latino)",
      "Decline to self-identify",
    ],
  },
  {
    name: "eeo[veteran]",
    id: "eeo-veteran",
    label: "Veteran status",
    options: ["I am not a protected veteran", "I identify as one or more of the classifications of protected veteran", "Decline to self-identify"],
  },
];

const LANGS = ["TypeScript", "Python", "Go", "Java", "Rust"];

function rules(job: Posting): Rule[] {
  const rs: Rule[] = [
    { name: "name", label: "Full name" },
    { name: "email", label: "Email" },
    { name: "resume", label: "Resume", file: true },
    { name: field0(CARD_AUTH), label: AUTH_LABEL },
    { name: field0(CARD_SPONSOR), label: SPONSORSHIP_LABEL },
  ];
  if (job.variants.includes("conditionalSponsorship")) {
    rs.push({ name: field0(CARD_VISA), label: VISA_LABEL, when: { name: field0(CARD_SPONSOR), value: "Yes" } });
  }
  rs.push({ name: field0(CARD_WHY), label: "Why are you interested in this role?" });
  return rs;
}

function text(id: string, name: string, label: string, required: boolean, type = "text"): string {
  return `<div class="field application-question"><label for="${id}" class="application-label">${esc(label)}${required ? REQ : ""}</label>
<input type="${type}" id="${id}" name="${esc(name)}"${required ? ' required aria-required="true"' : ""}></div>`;
}

function radioCard(cardId: string, label: string, options: string[], extra = ""): string {
  const name = field0(cardId);
  const legendId = `card-${cardId}-legend`;
  return `<fieldset class="application-question custom-question"${extra} aria-labelledby="${legendId}" role="radiogroup">
<legend id="${legendId}">${esc(label)}${REQ}</legend>
${options
  .map(
    (o, i) => `<label class="option" for="card-${cardId}-${i}"><input type="radio" id="card-${cardId}-${i}" name="${name}" value="${esc(o)}" required aria-required="true"> ${esc(o)}</label>`,
  )
  .join("")}</fieldset>`;
}

function form(job: Posting, errors: string[]): string {
  const conditional = job.variants.includes("conditionalSponsorship");
  const captcha = job.variants.includes("captcha");
  const visa = conditional
    ? `<div class="field application-question custom-question" data-depends-on="${field0(CARD_SPONSOR)}" data-depends-value="Yes" hidden>
<label for="card-${CARD_VISA}-0" class="application-label">${VISA_LABEL}</label><input type="text" disabled id="card-${CARD_VISA}-0" name="${field0(CARD_VISA)}"></div>`
    : "";
  const eeo = LEVER_EEO.map(
    (e) => `<div class="field application-question"><label for="${e.id}">${e.label}</label><select id="${e.id}" name="${e.name}"><option value="">Select...</option>${e.options
      .map((o) => `<option value="${esc(o)}">${esc(o)}</option>`)
      .join("")}</select></div>`,
  ).join("");
  return `${errorBanner(errors)}
<form id="application-form" method="post" action="/lever/${board.token}/${job.id}/apply" enctype="multipart/form-data" novalidate>
<h2>Submit your application</h2><p>${REQ} indicates a required field</p>
${text("name", "name", "Full name", true)}
${text("email", "email", "Email", true, "email")}
${text("phone", "phone", "Phone", false, "tel")}
${text("location", "location", "Current location", false)}
${text("org", "org", "Current company", false)}
<h3>Links</h3>
${text("urls_LinkedIn", "urls[LinkedIn]", "LinkedIn URL", false)}
${text("urls_GitHub", "urls[GitHub]", "GitHub URL", false)}
${text("urls_Portfolio", "urls[Portfolio]", "Portfolio URL", false)}
<div class="field application-question"><label for="resume-upload-input" class="application-label">Resume/CV${REQ}</label>
<input type="file" id="resume-upload-input" name="resume" accept=".pdf,.doc,.docx,.txt,.rtf" required aria-required="true"></div>
<h3>Additional questions</h3>
${radioCard(CARD_AUTH, AUTH_LABEL, ["Yes", "No"])}
${radioCard(CARD_SPONSOR, SPONSORSHIP_LABEL, ["Yes", "No"])}
${visa}
<fieldset class="application-question custom-question" aria-labelledby="card-${CARD_LANGS}-legend" role="group">
<legend id="card-${CARD_LANGS}-legend">Which languages have you used professionally?</legend>
${LANGS.map((l, i) => `<label class="option" for="card-${CARD_LANGS}-${i}"><input type="checkbox" id="card-${CARD_LANGS}-${i}" name="cards[${CARD_LANGS}][field0]" value="${l}"> ${l}</label>`).join("")}</fieldset>
${text(`card-${CARD_WHY}-0`, field0(CARD_WHY), "Why are you interested in this role?", true)}
<div class="field application-question"><label for="comments" class="application-label">Additional information</label>
<textarea id="comments" name="comments" rows="5" placeholder="Add a cover letter or anything else you want to share"></textarea></div>
<h3>U.S. Equal Employment Opportunity Information</h3><p>Completion of this section is voluntary and will not affect your application.</p>
${eeo}
${captcha ? `<div class="h-captcha" data-sitekey="fixture"><iframe title="hCaptcha challenge" src="about:blank" width="303" height="78"></iframe><textarea name="h-captcha-response" hidden aria-hidden="true" tabindex="-1"></textarea></div>` : ""}
<button type="submit" id="btn-submit" class="postings-btn template-btn-submit">Submit application</button>
</form>`;
}

const closedPage = (): Reply =>
  htmlReply(404, layout({ title: "Posting closed", body: `<h1>This posting is closed</h1><p>${esc(board.company)} is no longer accepting applications for this role.</p>` }));

function postingPage(job: Posting): Reply {
  const body = `<p class="company">${esc(board.company)}</p><h1 class="posting-headline">${esc(job.title)}</h1>
<div class="posting-categories"><span class="location">${esc(job.location)}</span> / <span class="department">${esc(job.department)}</span> / <span class="commitment">Full-time</span> / <span class="workplaceTypes">${esc(job.workplace)}</span></div>
<div class="section page-centered">${descriptionHtml(job.description)}</div>
<p><a class="postings-btn template-btn-submit" href="/lever/${board.token}/${job.id}/apply">Apply for this job</a></p>`;
  return htmlReply(200, layout({ title: `${board.company} - ${job.title}`, body }));
}

function applyPage(job: Posting, errors: string[], status = 200): Reply {
  const body = `<p class="company">${esc(board.company)}</p><h1>${esc(job.title)}</h1><p>${esc(job.location)}</p>${form(job, errors)}`;
  return htmlReply(status, layout({ title: `${board.company} - ${job.title} - Application`, body, script: CONDITIONAL_JS }));
}

const WORKPLACE = { remote: "remote", hybrid: "hybrid", onsite: "on-site" } as const;

function postingJson(job: Posting, origin: string): Record<string, unknown> {
  const base = `${origin}/lever/${board.token}/${job.id}`;
  return {
    id: job.id,
    text: job.title,
    categories: { location: job.location, commitment: "Full-time", team: job.team, department: job.department, allLocations: [job.location] },
    country: job.country,
    description: descriptionHtml(job.description),
    descriptionPlain: descriptionPlain(job.description),
    additional: `<div>${board.company} is an equal opportunity employer.</div>`,
    additionalPlain: `${board.company} is an equal opportunity employer.`,
    lists: job.description.sections.map((s) => ({ text: s.title, content: s.items.map((i) => `<li>${i}</li>`).join("") })),
    hostedUrl: base,
    applyUrl: `${base}/apply`,
    workplaceType: WORKPLACE[job.workplace],
    ...(job.kind !== "non-eng" ? { salaryRange: { currency: job.country === "GB" ? "GBP" : "USD", interval: "per-year-salary", min: 110000, max: 150000 } } : {}),
  };
}

export async function handleLever(ctx: Ctx): Promise<Reply | undefined> {
  const { path, method } = ctx;
  let m = /^\/lever\/v0\/postings\/([^/]+)$/.exec(path);
  if (m && method === "GET") {
    if (m[1] !== board.token) return jsonReply(404, { ok: false, error: "Document not found" });
    return jsonReply(200, board.postings.filter((p) => !p.closed).map((p) => postingJson(p, ctx.origin)));
  }
  m = /^\/lever\/([^/]+)\/([0-9a-f-]{36})(\/apply)?$/.exec(path);
  if (!m || m[1] !== board.token) return undefined;
  const id = m[2];
  const isApply = m[3] !== undefined;
  const job = board.postings.find((p) => p.id === id);
  if (!job || job.closed) return closedPage();
  if (method === "GET") return isApply ? applyPage(job, []) : postingPage(job);
  if (method === "POST" && isApply && ctx.form) {
    const errors = validate(ctx.form, rules(job));
    if (job.variants.includes("captcha")) {
      // The captcha can never be solved: the widget is a placeholder that produces no token.
      errors.push(fieldValue(ctx.form, "h-captcha-response") === "" ? "Please complete the captcha" : "Captcha verification failed");
    }
    if (errors.length > 0) return applyPage(job, errors, 400);
    const sub = ctx.record({ ats: "lever", board: board.token, jobId: job.id, parsed: ctx.form });
    return htmlReply(
      200,
      confirmationPage({
        heading: "Application submitted!",
        message: `Thanks for applying to ${board.company} (${countryName(job.country)}). We will be in touch.`,
        jobTitle: job.title,
        company: board.company,
        submissionId: sub.id,
      }),
    );
  }
  return undefined;
}

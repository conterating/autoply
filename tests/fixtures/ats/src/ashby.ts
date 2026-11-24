import { type Ctx, type Reply, type Rule, validate } from "./core.ts";
import { AUTH_LABEL, FIXTURE_BOARDS, SPONSORSHIP_LABEL, VISA_LABEL, countryName, descriptionHtml, descriptionPlain, type Posting } from "./data.ts";
import { CONDITIONAL_JS, REQ, confirmationPage, errorBanner, esc, htmlReply, jsonReply, layout } from "./html.ts";

const board = FIXTURE_BOARDS.ashby;

const Q_LINKEDIN = "5d0a1c00-0000-4000-8000-000000000001";
const Q_AUTH = "5d0a1c00-0000-4000-8000-000000000002";
const Q_SPONSOR = "5d0a1c00-0000-4000-8000-000000000003";
const Q_VISA = "5d0a1c00-0000-4000-8000-000000000004";
const Q_LANGS = "5d0a1c00-0000-4000-8000-000000000005";
const Q_WHY = "5d0a1c00-0000-4000-8000-000000000006";

const LANGS = ["TypeScript", "Python", "Go", "Java", "Rust"];

export const ASHBY_EEO = [
  { name: "eeoc_gender", label: "Gender", options: ["Male", "Female", "Non-binary", "Decline to self-identify"] },
  {
    name: "eeoc_race",
    label: "Race",
    options: [
      "Hispanic or Latino",
      "White (Not Hispanic or Latino)",
      "Black or African American (Not Hispanic or Latino)",
      "Asian (Not Hispanic or Latino)",
      "Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)",
      "American Indian or Alaska Native (Not Hispanic or Latino)",
      "Two or More Races (Not Hispanic or Latino)",
      "Decline to self-identify",
    ],
  },
  {
    name: "eeoc_veteran_status",
    label: "Veteran Status",
    options: ["I am not a protected veteran", "I identify as one or more of the classifications of protected veteran", "I don't wish to answer"],
  },
  {
    name: "eeoc_disability_status",
    label: "Disability Status",
    options: [
      "Yes, I have a disability, or have had one in the past",
      "No, I do not have a disability and have not had one in the past",
      "I do not want to answer",
    ],
  },
];

function rules(job: Posting): Rule[] {
  const rs: Rule[] = [
    { name: "_systemfield_name", label: "Name" },
    { name: "_systemfield_email", label: "Email" },
    { name: "_systemfield_resume", label: "Resume", file: true },
    { name: Q_AUTH, label: AUTH_LABEL },
    { name: Q_SPONSOR, label: SPONSORSHIP_LABEL },
  ];
  if (job.variants.includes("conditionalSponsorship")) {
    rs.push({ name: Q_VISA, label: VISA_LABEL, when: { name: Q_SPONSOR, value: "Yes" } });
  }
  rs.push({ name: Q_WHY, label: "Why do you want to work here?" });
  return rs;
}

function text(id: string, name: string, label: string, required: boolean, type = "text"): string {
  return `<div class="field _fieldEntry"><label for="${id}" class="_label">${esc(label)}${required ? REQ : ""}</label>
<input type="${type}" id="${id}" name="${name}" class="_input"${required ? ' required aria-required="true"' : ""}></div>`;
}

/** Yes/No rendered as two buttons that set a hidden input (the awkward Ashby variant). */
function yesNo(qid: string, label: string): string {
  const lid = `${qid}-label`;
  return `<div class="field _fieldEntry"><label id="${lid}" class="_label">${esc(label)}${REQ}</label>
<div class="yesno _yesno" role="group" aria-labelledby="${lid}" aria-required="true">
<button type="button" id="${qid}-yes" class="_option" aria-pressed="false" data-value="Yes">Yes</button><button type="button" id="${qid}-no" class="_option" aria-pressed="false" data-value="No">No</button>
<input type="hidden" id="${qid}" name="${qid}" value=""></div></div>`;
}

function radioGroup(name: string, label: string, options: string[]): string {
  return `<fieldset class="field _fieldEntry" id="${name}"><legend>${esc(label)}</legend>
${options.map((o, i) => `<label class="option" for="${name}-${i}"><input type="radio" id="${name}-${i}" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join("")}</fieldset>`;
}

const YESNO_JS = `
document.querySelectorAll('.yesno').forEach(function(g){var h=g.querySelector('input[type=hidden]');
g.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){h.value=b.getAttribute('data-value');
g.querySelectorAll('button').forEach(function(o){o.setAttribute('aria-pressed',String(o===b));});
h.dispatchEvent(new Event('change',{bubbles:true}));});});});
`;

const STEPS_JS = `
(function(){var form=document.getElementById('application-form');var s1=document.getElementById('step-1');var s2=document.getElementById('step-2');if(!s2)return;
var err=document.getElementById('step-error');
document.getElementById('next-btn').addEventListener('click',function(){
var missing=Array.prototype.filter.call(s1.querySelectorAll('[aria-required=true]'),function(el){
if(el.disabled||el.closest('[hidden]'))return false;
if(el.getAttribute('role')==='group'){return !el.querySelector('input[type=hidden]').value;}
return !(el.type==='file'?el.files.length:el.value);});
if(missing.length){err.hidden=false;(missing[0].querySelector?missing[0].querySelector('button')||missing[0]:missing[0]).focus();return;}
err.hidden=true;s1.hidden=true;s2.hidden=false;document.getElementById('step-indicator').textContent='Step 2 of 2';});
document.getElementById('back-btn').addEventListener('click',function(){s2.hidden=true;s1.hidden=false;document.getElementById('step-indicator').textContent='Step 1 of 2';});
})();
`;

function form(job: Posting, errors: string[]): string {
  const conditional = job.variants.includes("conditionalSponsorship");
  const multi = job.variants.includes("multiPage");
  const visa = conditional
    ? `<div class="field _fieldEntry" data-depends-on="${Q_SPONSOR}" data-depends-value="Yes" hidden>
<label for="${Q_VISA}" class="_label">${VISA_LABEL}</label><input type="text" disabled id="${Q_VISA}" name="${Q_VISA}" class="_input"></div>`
    : "";
  const step1 = `<h2>Application</h2><p>${REQ} indicates a required field</p>
${text("_systemfield_name", "_systemfield_name", "Name", true)}
${text("_systemfield_email", "_systemfield_email", "Email", true, "email")}
${text("_systemfield_phone", "_systemfield_phone", "Phone", false, "tel")}
${text("_systemfield_location", "_systemfield_location", "Location", false)}
<div class="field _fieldEntry"><label for="_systemfield_resume" class="_label">Resume${REQ}</label>
<input type="file" id="_systemfield_resume" name="_systemfield_resume" accept=".pdf,.doc,.docx,.txt,.rtf" required aria-required="true"></div>
${text(Q_LINKEDIN, Q_LINKEDIN, "LinkedIn URL", false)}
${yesNo(Q_AUTH, AUTH_LABEL)}
${yesNo(Q_SPONSOR, SPONSORSHIP_LABEL)}
${visa}
<fieldset class="field _fieldEntry" id="${Q_LANGS}-group"><legend>Which languages have you used professionally?</legend>
${LANGS.map((l, i) => `<label class="option" for="${Q_LANGS}-${i}"><input type="checkbox" id="${Q_LANGS}-${i}" name="${Q_LANGS}" value="${l}"> ${l}</label>`).join("")}</fieldset>
<div class="field _fieldEntry"><label for="${Q_WHY}" class="_label">Why do you want to work here?${REQ}</label>
<textarea id="${Q_WHY}" name="${Q_WHY}" rows="5" class="_input" required aria-required="true"></textarea></div>`;
  const eeo = `<h2>U.S. Equal Employment Opportunity Information</h2><p>Completion of this section is voluntary and will not affect your application.</p>
${ASHBY_EEO.map((e) => radioGroup(e.name, e.label, e.options)).join("")}`;
  const submit = `<button type="submit" id="submit-btn" class="_submit">Submit Application</button>`;
  const action = `action="/ashby/${board.token}/${job.id}/application"`;
  if (!multi) {
    return `${errorBanner(errors)}<form id="application-form" method="post" ${action} enctype="multipart/form-data" novalidate>${step1}${eeo}${submit}</form>`;
  }
  return `${errorBanner(errors)}<form id="application-form" method="post" ${action} enctype="multipart/form-data" novalidate>
<p id="step-indicator" aria-live="polite">Step 1 of 2</p>
<div id="step-1" data-step="1">${step1}<p id="step-error" role="alert" class="form-error" hidden>Please complete all required fields.</p><button type="button" id="next-btn">Next</button></div>
<div id="step-2" data-step="2" hidden>${eeo}<button type="button" id="back-btn">Back</button>${submit}</div>
</form>`;
}

const closedPage = (): Reply =>
  htmlReply(404, layout({ title: "Job not found", body: `<h1>This job is no longer accepting applications</h1>` }));

function overview(job: Posting): Reply {
  const body = `<p class="company">${esc(board.company)}</p><h1>${esc(job.title)}</h1><p>${esc(job.location)} &middot; ${esc(job.department)} &middot; ${esc(job.workplace)}</p>
<nav aria-label="Posting sections"><a href="/ashby/${board.token}/${job.id}" aria-current="page">Overview</a> | <a href="/ashby/${board.token}/${job.id}/application">Application</a></nav>
<div>${descriptionHtml(job.description)}</div>`;
  return htmlReply(200, layout({ title: `${job.title} @ ${board.company}`, body }));
}

function applicationPage(job: Posting, errors: string[], status = 200): Reply {
  const body = `<p class="company">${esc(board.company)}</p><h1>${esc(job.title)}</h1>${form(job, errors)}`;
  return htmlReply(status, layout({ title: `${job.title} @ ${board.company} - Application`, body, script: YESNO_JS + CONDITIONAL_JS + STEPS_JS }));
}

const WORKPLACE = { remote: "Remote", hybrid: "Hybrid", onsite: "OnSite" } as const;

function postingJson(job: Posting, origin: string, comp: boolean): Record<string, unknown> {
  const [locality, region] = job.location.split(", ");
  const jobUrl = `${origin}/ashby/${board.token}/${job.id}`;
  return {
    title: job.title,
    location: job.location,
    department: job.department,
    team: job.team,
    secondaryLocations: [],
    isListed: true,
    isRemote: job.workplace === "remote",
    workplaceType: WORKPLACE[job.workplace],
    descriptionHtml: descriptionHtml(job.description),
    descriptionPlain: descriptionPlain(job.description),
    publishedAt: `2026-10-${String(10 + (Number(job.id.slice(-1)) % 15)).padStart(2, "0")}T16:21:55.393+00:00`,
    employmentType: "FullTime",
    address: { postalAddress: { addressLocality: locality, addressRegion: region ?? "", addressCountry: countryName(job.country) } },
    jobUrl,
    applyUrl: `${jobUrl}/application`,
    ...(comp && job.kind !== "non-eng"
      ? {
          compensation: {
            compensationTierSummary: "$110K - $150K",
            scrapeableCompensationSalarySummary: "$110K - $150K",
            compensationTiers: [],
            summaryComponents: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "USD", minValue: 110000, maxValue: 150000 }],
          },
        }
      : {}),
  };
}

export async function handleAshby(ctx: Ctx): Promise<Reply | undefined> {
  const { path, method } = ctx;
  let m = /^\/ashby\/posting-api\/job-board\/([^/]+)$/.exec(path);
  if (m && method === "GET") {
    if (m[1] !== board.token) return jsonReply(404, { error: "Job board not found" });
    const comp = ctx.query.get("includeCompensation") === "true";
    return jsonReply(200, { apiVersion: "1", jobs: board.postings.filter((p) => !p.closed).map((p) => postingJson(p, ctx.origin, comp)) });
  }
  m = /^\/ashby\/([^/]+)\/([0-9a-f-]{36})(\/application)?$/.exec(path);
  if (!m || m[1] !== board.token) return undefined;
  const id = m[2];
  const isApp = m[3] !== undefined;
  const job = board.postings.find((p) => p.id === id);
  if (!job || job.closed) return closedPage();
  if (method === "GET") return isApp ? applicationPage(job, []) : overview(job);
  if (method === "POST" && isApp && ctx.form) {
    const errors = validate(ctx.form, rules(job));
    if (errors.length > 0) return applicationPage(job, errors, 400);
    const sub = ctx.record({ ats: "ashby", board: board.token, jobId: job.id, parsed: ctx.form });
    return htmlReply(
      200,
      confirmationPage({
        heading: "Your application was successfully submitted",
        message: "Thank you for your interest. Our team will review your application.",
        jobTitle: job.title,
        company: board.company,
        submissionId: sub.id,
      }),
    );
  }
  return undefined;
}

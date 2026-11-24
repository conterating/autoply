import { type Ctx, type Reply, type Rule, validate } from "./core.ts";
import { AUTH_LABEL, FIXTURE_BOARDS, SPONSORSHIP_LABEL, VISA_LABEL, descriptionHtml, type Posting } from "./data.ts";
import { CONDITIONAL_JS, REQ, confirmationPage, errorBanner, esc, htmlReply, jsonReply, layout } from "./html.ts";

const board = FIXTURE_BOARDS.greenhouse;

type Q = {
  name: string;
  label: string;
  required: boolean;
  type: "input_text" | "textarea" | "input_file" | "select";
  inputType?: "text" | "email" | "tel";
  values?: string[];
  /** Only shown after another field has a given value. */
  dependsOn?: { name: string; value: string };
};

const YES_NO = ["Yes", "No"];
const COUNTRIES = ["United States", "Canada", "United Kingdom", "India", "Germany"];

const Q_AUTH = "question_40100003";
const Q_SPONSOR = "question_40100004";
const Q_VISA = "question_40100005";

export const GH_EEO = [
  { name: "gender", label: "Gender", options: ["Male", "Female", "Decline To Self Identify"] },
  { name: "hispanic_ethnicity", label: "Are you Hispanic/Latino?", options: ["Yes", "No", "Decline To Self Identify"] },
  {
    name: "veteran_status",
    label: "Veteran Status",
    options: ["I am not a protected veteran", "I identify as one or more of the classifications of protected veteran", "I don't wish to answer"],
  },
  {
    name: "disability_status",
    label: "Disability Status",
    options: [
      "Yes, I have a disability (or previously had a disability)",
      "No, I do not have a disability and have not had one in the past",
      "I do not want to answer",
    ],
  },
];

function questions(job: Posting): Q[] {
  const conditional = job.variants.includes("conditionalSponsorship");
  const qs: Q[] = [
    { name: "first_name", label: "First Name", required: true, type: "input_text" },
    { name: "last_name", label: "Last Name", required: true, type: "input_text" },
    { name: "email", label: "Email", required: true, type: "input_text", inputType: "email" },
    { name: "country", label: "Country", required: true, type: "select", values: COUNTRIES },
    { name: "phone", label: "Phone", required: true, type: "input_text", inputType: "tel" },
    { name: "resume", label: "Resume/CV", required: true, type: "input_file" },
    { name: "cover_letter", label: "Cover Letter", required: false, type: "input_file" },
    { name: "question_40100001", label: "LinkedIn Profile", required: false, type: "input_text" },
    { name: "question_40100002", label: "Website", required: false, type: "input_text" },
    { name: Q_AUTH, label: AUTH_LABEL, required: true, type: "select", values: YES_NO },
    { name: Q_SPONSOR, label: SPONSORSHIP_LABEL, required: true, type: "select", values: YES_NO },
  ];
  if (conditional) qs.push({ name: Q_VISA, label: VISA_LABEL, required: true, type: "input_text", dependsOn: { name: Q_SPONSOR, value: "Yes" } });
  qs.push({ name: "question_40100006", label: `Why are you interested in ${board.company}?`, required: false, type: "textarea" });
  return qs;
}

function rules(job: Posting): Rule[] {
  const rs: Rule[] = [];
  for (const q of questions(job)) {
    if (q.required) rs.push({ name: q.name, label: q.label.replace("/CV", ""), file: q.type === "input_file", when: q.dependsOn });
  }
  return rs;
}

function combobox(id: string, name: string, label: string, options: string[], required: boolean): string {
  const labelId = `${id}-label`;
  return `<div class="select" data-combobox data-options="${esc(JSON.stringify(options))}">
<label id="${labelId}" for="${id}" class="label">${esc(label)}${required ? REQ : ""}</label>
<div class="select__control"><input id="${id}" type="text" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-listbox" aria-autocomplete="list" aria-labelledby="${labelId}"${required ? ' aria-required="true"' : ""} autocomplete="off" placeholder="Select..."></div>
<input type="hidden" name="${name}" value="">
</div>`;
}

function renderQuestion(q: Q): string {
  const star = q.required ? REQ : "";
  const aria = q.required ? ' required aria-required="true"' : "";
  let inner: string;
  switch (q.type) {
    case "input_text":
      inner = `<label for="${q.name}" id="${q.name}-label">${esc(q.label)}${star}</label><input type="${q.inputType ?? "text"}" id="${q.name}" name="${q.name}"${aria}>`;
      break;
    case "textarea":
      inner = `<label for="${q.name}" id="${q.name}-label">${esc(q.label)}${star}</label><textarea id="${q.name}" name="${q.name}" rows="5"${aria}></textarea>`;
      break;
    case "input_file":
      inner = `<label for="${q.name}" id="${q.name}-label">${esc(q.label)}${star}</label><input type="file" id="${q.name}" name="${q.name}" accept=".pdf,.doc,.docx,.txt,.rtf"${aria}>`;
      break;
    case "select":
      inner = combobox(q.name, q.name, q.label, q.values ?? [], q.required);
      break;
  }
  if (q.dependsOn) {
    // Conditional fields start hidden and disabled; CONDITIONAL_JS reveals them.
    const hiddenInner = inner.replace(/ required aria-required="true"/g, "").replace(/<input /g, "<input disabled ");
    return `<div class="field question" data-depends-on="${q.dependsOn.name}" data-depends-value="${q.dependsOn.value}" hidden>${hiddenInner}</div>`;
  }
  return `<div class="field question">${inner}</div>`;
}

const COMBOBOX_JS = `
document.querySelectorAll('[data-combobox]').forEach(function(root){
var input=root.querySelector('input[role=combobox]');var hidden=root.querySelector('input[type=hidden]');
var options=JSON.parse(root.getAttribute('data-options'));var labelId=input.getAttribute('aria-labelledby');var list=null;var active=-1;
function items(){return list?Array.prototype.slice.call(list.children):[];}
function highlight(i){var its=items();if(!its.length)return;active=(i+its.length)%its.length;its.forEach(function(li,n){li.classList.toggle('focused',n===active);});input.setAttribute('aria-activedescendant',its[active].id);}
function render(filter){if(!list){list=document.createElement('ul');list.id=input.getAttribute('aria-controls');list.setAttribute('role','listbox');list.className='select__menu';list.setAttribute('aria-labelledby',labelId);root.appendChild(list);input.setAttribute('aria-expanded','true');}
list.innerHTML='';active=-1;
options.forEach(function(o,i){if(filter&&o.toLowerCase().indexOf(filter.toLowerCase())===-1)return;
var li=document.createElement('li');li.setAttribute('role','option');li.id=input.id+'-option-'+i;li.setAttribute('aria-selected',String(o===hidden.value));li.textContent=o;
li.addEventListener('mousedown',function(e){e.preventDefault();});li.addEventListener('click',function(){choose(o);});list.appendChild(li);});}
function close(){if(!list)return;list.remove();list=null;active=-1;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');input.value=hidden.value;}
function choose(o){hidden.value=o;input.value=o;close();hidden.dispatchEvent(new Event('change',{bubbles:true}));}
input.addEventListener('click',function(){if(list)close();else render('');});
input.addEventListener('input',function(){render(input.value);});
input.addEventListener('keydown',function(e){
if(e.key==='ArrowDown'){e.preventDefault();if(!list)render('');highlight(active+1);}
else if(e.key==='ArrowUp'){e.preventDefault();if(!list)render('');highlight(active-1);}
else if(e.key==='Enter'){if(list){e.preventDefault();var its=items();if(its[active])its[active].click();else if(its.length===1)its[0].click();}}
else if(e.key==='Escape'){close();}});
input.addEventListener('blur',function(){close();});
});
`;

function form(job: Posting, errors: string[]): string {
  const qs = questions(job);
  const split = qs.findIndex((q) => q.name === "cover_letter") + 1;
  const core = qs.slice(0, split);
  const custom = qs.slice(split);
  const eeo = GH_EEO.map((e) => `<div class="field question">${combobox(e.name, e.name, e.label, e.options, false)}</div>`).join("");
  return `${errorBanner(errors)}
<form id="application-form" method="post" action="/greenhouse/${board.token}/jobs/${job.id}" enctype="multipart/form-data" novalidate>
<h2>Apply for this job</h2><p>${REQ} indicates a required field</p>
<section aria-labelledby="personal-h"><h3 id="personal-h">Personal information</h3>${core.map(renderQuestion).join("")}</section>
<section aria-labelledby="custom-h"><h3 id="custom-h">Additional questions</h3>${custom.map(renderQuestion).join("")}</section>
<section aria-labelledby="eeo-h"><h3 id="eeo-h">U.S. Equal Employment Opportunity Information</h3>
<p>Completion of this section is voluntary and will not affect your application.</p>${eeo}</section>
<button type="submit">Submit application</button>
</form>`;
}

function jobPage(job: Posting, errors: string[], status = 200): Reply {
  const body = `<p class="company">${esc(board.company)}</p><h1 class="section-header">${esc(job.title)}</h1><p class="job__location">${esc(job.location)}</p>
<div class="job__description">${descriptionHtml(job.description)}</div>${form(job, errors)}`;
  return htmlReply(status, layout({ title: `Job Application for ${job.title} at ${board.company}`, body, script: COMBOBOX_JS + CONDITIONAL_JS }));
}

const closedPage = (): Reply =>
  htmlReply(404, layout({ title: "Job not found", body: `<h1>This job is no longer accepting applications</h1><p>Browse other open roles at ${esc(board.company)}.</p>` }));

function jobJson(job: Posting, origin: string, content: boolean): Record<string, unknown> {
  const n = Number(job.id);
  return {
    id: n,
    internal_job_id: n + 1_000_000,
    title: job.title,
    updated_at: job.updatedAt,
    requisition_id: String(n % 1000),
    location: { name: job.location },
    absolute_url: `${origin}/greenhouse/${board.token}/jobs/${job.id}`,
    language: "en",
    metadata: null,
    ...(content ? { content: esc(descriptionHtml(job.description)) } : {}),
    departments: [{ id: 13583, name: job.department, parent_id: null, child_ids: [] }],
    offices: [{ id: 8304, name: job.location, location: job.location, parent_id: null, child_ids: [] }],
  };
}

function questionsJson(job: Posting): Record<string, unknown> {
  const qJson = questions(job).map((q) => ({
    required: q.required,
    label: q.label,
    fields: [
      {
        name: q.name,
        type: q.type === "select" ? "multi_value_single_select" : q.type,
        ...(q.type === "select" ? { values: (q.values ?? []).map((v, i) => ({ value: i + 1, label: v })) } : {}),
      },
    ],
  }));
  return {
    questions: qJson,
    demographic_questions: {
      header: "U.S. Equal Employment Opportunity Information",
      description: "Completion of this section is voluntary and will not affect your application.",
      questions: GH_EEO.map((e, i) => ({
        id: 9000 + i,
        label: e.label,
        required: false,
        type: "multi_value_single_select",
        answer_options: e.options.map((o, j) => ({ id: 90000 + i * 10 + j, label: o, free_form: false })),
      })),
    },
  };
}

export async function handleGreenhouse(ctx: Ctx): Promise<Reply | undefined> {
  const { path, method } = ctx;
  let m = /^\/greenhouse\/boards-api\/v1\/boards\/([^/]+)\/jobs$/.exec(path);
  if (m && method === "GET") {
    if (m[1] !== board.token) return jsonReply(404, { status: 404, error: "Job not found" });
    const jobs = board.postings.filter((p) => !p.closed).map((p) => jobJson(p, ctx.origin, ctx.query.get("content") === "true"));
    return jsonReply(200, { jobs, meta: { total: jobs.length } });
  }
  m = /^\/greenhouse\/boards-api\/v1\/boards\/([^/]+)\/jobs\/(\d+)$/.exec(path);
  if (m && method === "GET") {
    const id = m[2];
    const job = board.postings.find((p) => p.id === id);
    if (m[1] !== board.token || !job || job.closed) return jsonReply(404, { status: 404, error: "Job not found" });
    return jsonReply(200, {
      ...jobJson(job, ctx.origin, true),
      ...(ctx.query.get("questions") === "true" ? questionsJson(job) : {}),
    });
  }
  m = /^\/greenhouse\/([^/]+)\/jobs\/(\d+)$/.exec(path);
  if (!m || m[1] !== board.token) return undefined;
  const id = m[2];
  const job = board.postings.find((p) => p.id === id);
  if (!job) return closedPage();
  if (method === "GET") return job.closed ? closedPage() : jobPage(job, []);
  if (method === "POST" && ctx.form) {
    if (job.closed) return closedPage();
    if (job.variants.includes("serverError")) {
      return htmlReply(500, layout({ title: "Error", body: `<h1>Something went wrong. Please try again.</h1>` }));
    }
    const errors = validate(ctx.form, rules(job));
    if (errors.length > 0) return jobPage(job, errors, 400);
    const sub = ctx.record({ ats: "greenhouse", board: board.token, jobId: job.id, parsed: ctx.form });
    return htmlReply(
      200,
      confirmationPage({ heading: "Thank you for applying.", message: "Your application has been submitted.", jobTitle: job.title, company: board.company, submissionId: sub.id }),
    );
  }
  return undefined;
}

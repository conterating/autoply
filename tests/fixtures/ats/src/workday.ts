import { randomBytes } from "node:crypto";
import { type Ctx, type Reply, fieldValue } from "./core.ts";
import { FIXTURE_BOARDS, descriptionHtml, type Posting } from "./data.ts";
import { esc, htmlReply } from "./html.ts";

/**
 * Replica of a Workday (myworkdayjobs.com) candidate flow: posting → Apply →
 * Apply Manually → Sign In / Create Account → six-page application with a
 * progress bar → Review → Submit. Stateful per server: accounts, sessions and
 * per-account drafts live in `ctx.state` (cleared by `reset()`).
 */

const board = FIXTURE_BOARDS.workday;
const PREFIX = `/workday/${board.token}/External`;

// ------------------------------------------------------------------ form spec

type Kind = "text" | "tel" | "textarea" | "dropdown" | "radio" | "checkbox" | "file";
type FieldSpec = {
  /** Input name, and the suffix of the container's `formField-<name>` automation id. */
  name: string;
  /** `data-automation-id` of the control itself. */
  auto: string;
  label: string;
  kind: Kind;
  required: boolean;
  options?: string[];
  placeholder?: string;
};
type PageSpec = { slug: string; title: string; intro?: string; fields: FieldSpec[] };

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "District of Columbia", "Florida",
  "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts",
  "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico",
  "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

const YES_NO = ["Yes", "No"];

export const WORKDAY_PAGES: PageSpec[] = [
  {
    slug: "myInformation",
    title: "My Information",
    fields: [
      {
        name: "source--source",
        auto: "sourceDropdown",
        label: "How Did You Hear About Us?",
        kind: "dropdown",
        required: true,
        options: ["Company Website", "LinkedIn", "Indeed", "Glassdoor", "Employee Referral", "Career Fair", "University Event", "Social Media", "Other"],
      },
      { name: "candidateIsPreviousWorker", auto: "previousWorker", label: "Have you previously worked for Woodgrove Bank?", kind: "radio", required: true, options: YES_NO },
      { name: "legalName--firstName", auto: "legalNameSection_firstName", label: "Given Name(s)", kind: "text", required: true },
      { name: "legalName--lastName", auto: "legalNameSection_lastName", label: "Family Name", kind: "text", required: true },
      { name: "address--addressLine1", auto: "addressSection_addressLine1", label: "Address Line 1", kind: "text", required: true },
      { name: "address--city", auto: "addressSection_city", label: "City", kind: "text", required: true },
      { name: "address--countryRegion", auto: "addressSection_countryRegion", label: "State", kind: "dropdown", required: true, options: US_STATES },
      { name: "address--postalCode", auto: "addressSection_postalCode", label: "Postal Code", kind: "text", required: true },
      { name: "phone--deviceType", auto: "phone-device-type", label: "Phone Device Type", kind: "dropdown", required: true, options: ["Mobile", "Home", "Work"] },
      { name: "phone--phoneNumber", auto: "phone-number", label: "Phone Number", kind: "tel", required: true },
    ],
  },
  {
    slug: "myExperience",
    title: "My Experience",
    fields: [
      { name: "resume", auto: "file-upload-input-ref", label: "Resume/CV", kind: "file", required: true },
      { name: "linkedInAccount", auto: "linkedinQuestion", label: "LinkedIn Profile", kind: "text", required: false },
    ],
  },
  {
    slug: "applicationQuestions",
    title: "Application Questions",
    fields: [
      { name: "q--workAuthorization", auto: "workAuthorizationDropdown", label: "Are you legally authorized to work in the United States?", kind: "dropdown", required: true, options: YES_NO },
      {
        name: "q--sponsorship",
        auto: "sponsorshipDropdown",
        label: "Will you now or in the future require sponsorship for employment visa status?",
        kind: "dropdown",
        required: true,
        options: YES_NO,
      },
      { name: "q--whyInterested", auto: "whyInterestedQuestion", label: "Why are you interested in working at Woodgrove Bank?", kind: "textarea", required: true },
    ],
  },
  {
    slug: "voluntaryDisclosures",
    title: "Voluntary Disclosures",
    intro: "Woodgrove Bank is an equal opportunity employer. Providing this information is voluntary and will not affect your application.",
    fields: [
      {
        name: "voluntary--gender",
        auto: "genderDropdown",
        label: "Gender",
        kind: "dropdown",
        required: true,
        options: ["Male", "Female", "Non-binary", "I do not wish to self-identify"],
      },
      {
        name: "voluntary--ethnicity",
        auto: "ethnicityDropdown",
        label: "Race/Ethnicity",
        kind: "dropdown",
        required: true,
        options: [
          "Hispanic or Latino",
          "White (United States of America)",
          "Black or African American (United States of America)",
          "Asian (United States of America)",
          "American Indian or Alaska Native (United States of America)",
          "Native Hawaiian or Other Pacific Islander (United States of America)",
          "Two or More Races (United States of America)",
          "I do not wish to answer",
        ],
      },
      {
        name: "voluntary--veteranStatus",
        auto: "veteranStatusDropdown",
        label: "Veteran Status",
        kind: "dropdown",
        required: true,
        options: [
          "I am not a protected veteran",
          "I identify as one or more of the classifications of protected veteran",
          "I do not wish to self-identify",
        ],
      },
      { name: "termsAndConditions--acceptTermsAndAgreements", auto: "legalNoticeAcceptanceCheckbox", label: "I have read and consent to the terms and conditions.", kind: "checkbox", required: true },
    ],
  },
  {
    slug: "selfIdentify",
    title: "Self Identify",
    intro: "Voluntary Self-Identification of Disability (Form CC-305). Because we do business with the government, we must reach out to, hire, and provide equal opportunity to qualified people with disabilities.",
    fields: [
      { name: "selfIdentifiedDisabilityData--name", auto: "selfIdentifiedDisabilitySection_name", label: "Name", kind: "text", required: true },
      { name: "selfIdentifiedDisabilityData--dateSignedOn", auto: "selfIdentifiedDisabilitySection_date", label: "Date", kind: "text", required: true, placeholder: "MM/DD/YYYY" },
      {
        name: "selfIdentifiedDisabilityData--disabilityStatus",
        auto: "disabilityStatus",
        label: "Disability Status",
        kind: "radio",
        required: true,
        options: [
          "Yes, I have a disability, or have had one in the past",
          "No, I do not have a disability and have not had one in the past",
          "I do not want to answer",
        ],
      },
    ],
  },
  { slug: "review", title: "Review", fields: [] },
];

const REVIEW_INDEX = WORKDAY_PAGES.length - 1;
const FORM_PAGES = WORKDAY_PAGES.slice(0, REVIEW_INDEX);
const PASSWORD_RULE = "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number and a special character.";

// ------------------------------------------------------------------ state

type Account = { password: string; verified: boolean };
type Draft = {
  values: Record<string, string>;
  files: Record<string, { filename: string; size: number; contentType: string }>;
  /** Number of pages the candidate has completed (Save and Continue succeeded). */
  completed: number;
  submissionId?: string;
};
type WorkdayState = { accounts: Map<string, Account>; sessions: Map<string, string>; drafts: Map<string, Draft> };

function stateOf(ctx: Ctx): WorkdayState {
  ctx.state.workday ??= { accounts: new Map(), sessions: new Map(), drafts: new Map() } satisfies WorkdayState;
  return ctx.state.workday as WorkdayState;
}

const COOKIE = "wd_session";
const sessionEmail = (ctx: Ctx): string | undefined => {
  const t = ctx.cookies[COOKIE];
  return t ? stateOf(ctx).sessions.get(t) : undefined;
};
const draftOf = (ctx: Ctx, email: string, reqId: string): Draft => {
  const key = `${email}|${reqId}`;
  const { drafts } = stateOf(ctx);
  let d = drafts.get(key);
  if (!d) {
    d = { values: {}, files: {}, completed: 0 };
    drafts.set(key, d);
  }
  return d;
};

// ------------------------------------------------------------------ postings

const slugify = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const workdayPostingPath = (p: Posting): string => `${PREFIX}/job/${slugify(p.location)}/${slugify(p.title)}_${p.id}`;

const jobById = (id: string): Posting | undefined => board.postings.find((p) => p.id === id);

const redirect = (location: string, headers: Record<string, string> = {}): Reply => ({ status: 303, body: "", headers: { location, ...headers } });

const CSS = `
body{font:16px/1.5 "Helvetica Neue",Arial,sans-serif;margin:0;color:#1a1a1a;background:#f7f7f7}
header.top{background:#0b3d91;color:#fff;padding:12px 24px;font-weight:600}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px;background:#fff;min-height:70vh}
h1{font-size:28px;margin:8px 0}h2{font-size:22px;margin:24px 0 8px}
ol[data-automation-id=progressBar]{display:flex;gap:8px;list-style:none;padding:0;margin:0 0 24px;flex-wrap:wrap}
ol[data-automation-id=progressBar] li{flex:1;min-width:110px;padding:8px;border-bottom:4px solid #c8c8c8;font-size:14px;color:#555}
ol[data-automation-id=progressBar] li[data-automation-id=progressBarActiveStep]{border-color:#0b3d91;color:#000;font-weight:700}
ol[data-automation-id=progressBar] li[data-automation-id=progressBarCompletedStep]{border-color:#2e7d32}
.field{margin:16px 0;position:relative}
label,.lbl{display:block;font-weight:600;margin-bottom:4px}
input[type=text],input[type=tel],input[type=email],input[type=password],textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid #767676;border-radius:4px;font:inherit}
button[aria-haspopup=listbox]{width:100%;text-align:left;padding:8px;border:1px solid #767676;border-radius:4px;background:#fff;font:inherit;cursor:pointer}
ul[role=listbox]{position:absolute;left:0;right:0;z-index:10;margin:2px 0 0;padding:0;list-style:none;background:#fff;border:1px solid #767676;border-radius:4px;max-height:220px;overflow:auto}
ul[role=listbox] li{padding:8px 12px;cursor:pointer}ul[role=listbox] li:hover{background:#e6eefc}
.radio{display:block;font-weight:400;margin:4px 0}.radio label{display:inline;font-weight:400}
.req{color:#b00020;margin-left:2px}
[data-automation-id=errorMessage]{color:#b00020;font-size:14px;margin-top:4px}
[data-automation-id=errorBanner]{border:2px solid #b00020;background:#fdecea;color:#7a0016;padding:12px 16px;border-radius:4px;margin:16px 0}
.nav{display:flex;gap:12px;margin-top:32px}
button,.btn{font:inherit;padding:10px 24px;border-radius:24px;border:1px solid #0b3d91;background:#fff;color:#0b3d91;cursor:pointer;text-decoration:none;display:inline-block}
button.primary,.btn.primary{background:#0b3d91;color:#fff}
dl.review{display:grid;grid-template-columns:240px 1fr;gap:4px 16px}dl.review dt{font-weight:600}dl.review dd{margin:0}
[hidden]{display:none!important}
`;

function page(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><header class="top">Woodgrove Bank Careers</header><main>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

const notFound = (): Reply => htmlReply(404, page("Page not found", `<h1 data-automation-id="pageNotFound">Page not found</h1><p>The page you are looking for doesn't exist.</p>`));

function postingPage(job: Posting): Reply {
  const path = workdayPostingPath(job);
  return htmlReply(
    200,
    page(
      `${job.title} - ${board.company}`,
      `<h1 data-automation-id="jobPostingHeader">${esc(job.title)}</h1>
<p><span data-automation-id="locations">${esc(job.location)}</span> · <span data-automation-id="requisitionId">${esc(job.id)}</span></p>
<p><a class="btn primary" role="button" data-automation-id="adventureButton" href="${path}/apply">Apply</a></p>
<div data-automation-id="jobPostingDescription">${descriptionHtml(job.description)}</div>`,
    ),
  );
}

function listingPage(): Reply {
  const items = board.postings
    .filter((p) => !p.closed)
    .map((p) => `<li><a data-automation-id="jobTitle" href="${workdayPostingPath(p)}">${esc(p.title)}</a> <span>${esc(p.location)}</span> <span>${esc(p.id)}</span></li>`)
    .join("");
  return htmlReply(200, page(`Careers - ${board.company}`, `<h1>Search for Jobs</h1><ul data-automation-id="jobResults">${items}</ul>`));
}

function applyChoicePage(job: Posting): Reply {
  const path = workdayPostingPath(job);
  return htmlReply(
    200,
    page(
      "Start Your Application",
      `<div role="dialog" aria-modal="true" aria-labelledby="dlg" data-automation-id="applyModal">
<h2 id="dlg">Start Your Application</h2>
<p><a class="btn" role="button" aria-disabled="true" data-automation-id="autofillWithResume" href="#">Autofill with Resume</a></p>
<p><a class="btn" role="button" aria-disabled="true" data-automation-id="useMyLastApplication" href="#">Use My Last Application</a></p>
<p><a class="btn primary" role="button" data-automation-id="applyManually" href="${path}/apply/applyManually">Apply Manually</a></p>
</div>`,
    ),
  );
}

// ------------------------------------------------------------------ auth

function authPage(job: Posting, mode: "signin" | "create", opts: { email?: string; errors?: string[] } = {}): Reply {
  const action = `${PREFIX}/login/${job.id}?mode=${mode}`;
  const errors = (opts.errors ?? [])
    .map((e) => `<div data-automation-id="errorMessage" role="alert">${esc(e)}</div>`)
    .join("");
  const emailField = `<div class="field" data-automation-id="formField-email"><label for="wd-email">Email Address${`<span class="req" aria-hidden="true">*</span>`}</label><input type="text" id="wd-email" name="email" autocomplete="username" data-automation-id="email" value="${esc(opts.email ?? "")}" aria-required="true"></div>`;
  const pw = (id: string, name: string, auto: string, label: string): string =>
    `<div class="field" data-automation-id="formField-${name}"><label for="${id}">${label}<span class="req" aria-hidden="true">*</span></label><input type="password" id="${id}" name="${name}" data-automation-id="${auto}" aria-required="true"></div>`;
  const body =
    mode === "signin"
      ? `<h2 data-automation-id="signInContent">Sign In</h2>${errors}<form method="post" action="${action}" novalidate>${emailField}${pw("wd-password", "password", "password", "Password")}
<button type="submit" class="primary" data-automation-id="signInSubmitButton">Sign In</button></form>
<p>Don't have an account? <a data-automation-id="createAccountLink" href="${PREFIX}/login/${job.id}?mode=create">Create Account</a></p>`
      : `<h2 data-automation-id="createAccountContent">Create Account</h2>${errors}<form method="post" action="${action}" novalidate>${emailField}${pw("wd-password", "password", "password", "Password")}${pw("wd-verify", "verifyPassword", "verifyPassword", "Verify New Password")}
<div class="field" data-automation-id="formField-createAccountCheckbox"><input type="checkbox" id="wd-terms" name="createAccountCheckbox" value="true" data-automation-id="createAccountCheckbox"><label for="wd-terms" style="display:inline">I have read and agree to the terms and conditions of the candidate privacy notice.<span class="req" aria-hidden="true">*</span></label></div>
<button type="submit" class="primary" data-automation-id="createAccountSubmitButton">Create Account</button></form>
<p>Already have an account? <a data-automation-id="signInLink" href="${PREFIX}/login/${job.id}?mode=signin">Sign In</a></p>`;
  return htmlReply(200, page(mode === "signin" ? "Sign In" : "Create Account", body));
}

function verifyPage(email: string): Reply {
  return htmlReply(
    200,
    page(
      "Verify Your Email",
      `<h2 data-automation-id="verifyEmailHeading">Verify Your Email Address</h2><p data-automation-id="verifyEmailMessage">We sent a verification link to ${esc(email)}. Open the link in that email to activate your account, then sign in.</p>`,
    ),
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strongPassword = (p: string): boolean => p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);

function startSession(ctx: Ctx, email: string, location: string): Reply {
  const token = randomBytes(16).toString("hex");
  stateOf(ctx).sessions.set(token, email);
  return redirect(location, { "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax` });
}

function handleAuth(ctx: Ctx, job: Posting): Reply {
  const mode = ctx.query.get("mode") === "create" ? "create" : "signin";
  if (ctx.method !== "POST" || !ctx.form) return authPage(job, mode);
  const st = stateOf(ctx);
  const email = fieldValue(ctx.form, "email").toLowerCase();
  const password = fieldValue(ctx.form, "password");
  const first = `${PREFIX}/apply/${job.id}/${WORKDAY_PAGES[0]!.slug}`;
  if (mode === "signin") {
    const acct = st.accounts.get(email);
    if (!acct || acct.password !== password) return authPage(job, mode, { email, errors: ["The email address or password you entered is incorrect. Please try again."] });
    if (!acct.verified) return verifyPage(email);
    return startSession(ctx, email, first);
  }
  const errors: string[] = [];
  const verify = fieldValue(ctx.form, "verifyPassword");
  if (!EMAIL_RE.test(email)) errors.push("Enter a valid email address.");
  if (!strongPassword(password)) errors.push(PASSWORD_RULE);
  if (password !== verify) errors.push("The passwords you entered do not match.");
  if (fieldValue(ctx.form, "createAccountCheckbox") !== "true") errors.push("You must accept the terms and conditions to create an account.");
  if (!errors.length && st.accounts.has(email)) errors.push("An account with this email address already exists. Sign in instead.");
  if (errors.length) return authPage(job, mode, { email, errors });
  const verified = !job.variants.includes("emailVerification");
  st.accounts.set(email, { password, verified });
  return verified ? startSession(ctx, email, first) : verifyPage(email);
}

// ------------------------------------------------------------------ application pages

const errText = (f: FieldSpec): string => `The field ${f.label.replace(/[?:]$/, "")} is required and must have a value.`;

function progressBar(index: number): string {
  return `<ol data-automation-id="progressBar" aria-label="Application progress">${WORKDAY_PAGES.map((p, i) => {
    const id = i === index ? "progressBarActiveStep" : i < index ? "progressBarCompletedStep" : "progressBarInactiveStep";
    return `<li data-automation-id="${id}"${i === index ? ' aria-current="step"' : ""}>${i + 1}. ${esc(p.title)}</li>`;
  }).join("")}</ol>`;
}

function renderField(f: FieldSpec, d: Draft, error: boolean): string {
  const id = `wd-${f.name.replace(/[^A-Za-z0-9]+/g, "-")}`;
  const val = d.values[f.name] ?? "";
  const req = f.required ? `<span class="req" aria-hidden="true">*</span>` : "";
  const reqAttr = f.required ? ` aria-required="true"` : "";
  const invalid = error ? ` aria-invalid="true" aria-describedby="${id}-error"` : "";
  let control: string;
  let label = `<label for="${id}" id="${id}-label">${esc(f.label)}${req}</label>`;
  switch (f.kind) {
    case "text":
    case "tel":
      control = `<input type="${f.kind === "tel" ? "tel" : "text"}" id="${id}" name="${esc(f.name)}" data-automation-id="${f.auto}" value="${esc(val)}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""}${reqAttr}${invalid}>`;
      break;
    case "textarea":
      control = `<textarea id="${id}" name="${esc(f.name)}" rows="4" data-automation-id="${f.auto}"${reqAttr}${invalid}>${esc(val)}</textarea>`;
      break;
    case "dropdown":
      control = `<button type="button" id="${id}" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}-label ${id}" data-automation-id="${f.auto}"${reqAttr}${invalid}>${esc(val || "Select One")}</button><input type="hidden" name="${esc(f.name)}" value="${esc(val)}">`;
      break;
    case "radio":
      label = `<span class="lbl" id="${id}-label">${esc(f.label)}${req}</span>`;
      control = `<div role="radiogroup" aria-labelledby="${id}-label"${reqAttr}${invalid}>${(f.options ?? [])
        .map(
          (o, i) =>
            `<div class="radio"><input type="radio" id="${id}-${i}" name="${esc(f.name)}" value="${esc(o)}" data-automation-id="${f.auto}"${val === o ? " checked" : ""}> <label for="${id}-${i}">${esc(o)}</label></div>`,
        )
        .join("")}</div>`;
      break;
    case "checkbox":
      label = "";
      control = `<input type="checkbox" id="${id}" name="${esc(f.name)}" value="true" data-automation-id="${f.auto}"${val === "true" ? " checked" : ""}${reqAttr}${invalid}> <label for="${id}" id="${id}-label" style="display:inline">${esc(f.label)}${req}</label>`;
      break;
    case "file": {
      const up = d.files[f.name];
      control = `<input type="file" id="${id}" name="${esc(f.name)}" data-automation-id="${f.auto}"${reqAttr}${invalid}>
<div data-automation-id="file-upload-item">${up ? `<span data-automation-id="file-upload-successful">Successfully Uploaded! ${esc(up.filename)}</span>` : ""}</div>`;
      break;
    }
  }
  return `<div class="field" data-automation-id="formField-${esc(f.name)}">${label}${control}${error ? `<div data-automation-id="errorMessage" id="${id}-error" role="alert">Error: ${esc(errText(f))}</div>` : ""}</div>`;
}

/** Workday-style dropdown: a button that opens a `role=listbox` popup (only in the DOM while open). */
function dropdownScript(index: number): string {
  const opts: Record<string, string[]> = {};
  for (const f of WORKDAY_PAGES[index]!.fields) if (f.kind === "dropdown") opts[`wd-${f.name.replace(/[^A-Za-z0-9]+/g, "-")}`] = f.options ?? [];
  return `(function(){
var OPTS=${JSON.stringify(opts)};
function closeList(){var l=document.querySelector('ul[role=listbox]');if(!l)return;var b=document.getElementById(l.getAttribute('data-for'));l.remove();if(b)b.setAttribute('aria-expanded','false');}
function openList(b){closeList();var ul=document.createElement('ul');ul.setAttribute('role','listbox');ul.id=b.id+'-listbox';ul.setAttribute('data-for',b.id);ul.setAttribute('aria-labelledby',b.id+'-label');
(OPTS[b.id]||[]).forEach(function(o,i){var li=document.createElement('li');li.setAttribute('role','option');li.setAttribute('data-automation-id','promptOption');li.id=b.id+'-option-'+i;li.tabIndex=-1;li.textContent=o;
li.addEventListener('click',function(e){e.stopPropagation();var h=b.parentNode.querySelector('input[type=hidden]');h.value=o;b.textContent=o;h.dispatchEvent(new Event('change',{bubbles:true}));closeList();b.focus();});ul.appendChild(li);});
b.parentNode.appendChild(ul);b.setAttribute('aria-expanded','true');b.setAttribute('aria-controls',ul.id);}
document.querySelectorAll('button[aria-haspopup=listbox]').forEach(function(b){
b.addEventListener('click',function(e){e.stopPropagation();if(b.getAttribute('aria-expanded')==='true')closeList();else openList(b);});
b.addEventListener('keydown',function(e){if(e.key==='ArrowDown'||e.key==='Enter'){e.preventDefault();openList(b);}});});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeList();});
document.addEventListener('click',closeList);
document.querySelectorAll('input[type=file]').forEach(function(i){i.addEventListener('change',function(){var t=i.parentNode.querySelector('[data-automation-id=file-upload-item]');t.innerHTML='';if(i.files&&i.files[0]){var s=document.createElement('span');s.setAttribute('data-automation-id','file-upload-successful');s.textContent='Successfully Uploaded! '+i.files[0].name;t.appendChild(s);}});});
})();`;
}

function reviewRows(d: Draft): string {
  return FORM_PAGES.flatMap((p) => p.fields)
    .map((f) => {
      const v = f.kind === "file" ? (d.files[f.name]?.filename ?? "") : f.kind === "checkbox" ? (d.values[f.name] === "true" ? "Yes" : "No") : (d.values[f.name] ?? "");
      return `<dt>${esc(f.label)}</dt><dd data-automation-id="reviewRow">${esc(v)}</dd>`;
    })
    .join("");
}

function applicationPage(job: Posting, index: number, d: Draft, errors: FieldSpec[] = [], banner: string[] = []): Reply {
  const spec = WORKDAY_PAGES[index]!;
  const action = `${PREFIX}/apply/${job.id}/${spec.slug}`;
  const bannerHtml =
    errors.length || banner.length
      ? `<div data-automation-id="errorBanner" role="alert" tabindex="-1"><h3 data-automation-id="errorHeading">Errors Found</h3><ul>${[...errors.map(errText), ...banner].map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`
      : "";
  const failed = new Set(errors.map((f) => f.name));
  const back =
    index > 0 ? `<button type="submit" formnovalidate name="_action" value="back" data-automation-id="bottom-navigation-back-button">Back</button>` : "";
  const next =
    index === REVIEW_INDEX
      ? `<button type="submit" class="primary" name="_action" value="submit" data-automation-id="pageFooterSubmitButton">Submit</button>`
      : `<button type="submit" class="primary" name="_action" value="next" data-automation-id="bottom-navigation-next-button">Save and Continue</button>`;
  const fields = index === REVIEW_INDEX ? `<dl class="review" data-automation-id="reviewSection">${reviewRows(d)}</dl>` : spec.fields.map((f) => renderField(f, d, failed.has(f.name))).join("");
  return htmlReply(
    200,
    page(
      `${spec.title} - ${job.title}`,
      `${progressBar(index)}<h2 data-automation-id="pageHeader">${esc(spec.title)}</h2>${spec.intro ? `<p data-automation-id="pageIntro">${esc(spec.intro)}</p>` : ""}${bannerHtml}
<form method="post" action="${action}" enctype="multipart/form-data" novalidate data-automation-id="applicationForm">${fields}<div class="nav">${back}${next}</div></form>`,
      dropdownScript(index),
    ),
  );
}

function missing(spec: PageSpec, d: Draft): FieldSpec[] {
  return spec.fields.filter((f) => f.required && (f.kind === "file" ? !d.files[f.name] : (d.values[f.name] ?? "") === ""));
}

function handleApplication(ctx: Ctx, job: Posting, step: string): Reply {
  const email = sessionEmail(ctx);
  if (!email) return redirect(`${PREFIX}/login/${job.id}`);
  const d = draftOf(ctx, email, job.id);
  if (step === "confirmation") {
    if (!d.submissionId) return redirect(`${PREFIX}/apply/${job.id}/${WORKDAY_PAGES[Math.min(d.completed, REVIEW_INDEX)]!.slug}`);
    return htmlReply(
      200,
      page(
        "Application Submitted",
        `<h2 data-automation-id="applicationSubmittedHeading">Application Submitted</h2><p>Thank you for applying for ${esc(job.title)}. We will be in touch.</p><p>Confirmation ID: <code data-testid="submission-id" id="submission-id">${esc(d.submissionId)}</code></p>`,
      ),
    );
  }
  const index = WORKDAY_PAGES.findIndex((p) => p.slug === step);
  if (index < 0) return notFound();
  if (d.submissionId) return redirect(`${PREFIX}/apply/${job.id}/confirmation`);
  if (index > d.completed) return redirect(`${PREFIX}/apply/${job.id}/${WORKDAY_PAGES[Math.min(d.completed, REVIEW_INDEX)]!.slug}`);
  const spec = WORKDAY_PAGES[index]!;
  if (ctx.method !== "POST" || !ctx.form) return applicationPage(job, index, d);

  const form = ctx.form;
  const action = fieldValue(form, "_action");
  if (index !== REVIEW_INDEX) {
    for (const f of spec.fields) {
      if (f.kind === "file") {
        const up = form.files[f.name];
        if (up && up.size > 0) d.files[f.name] = up;
      } else if (f.kind === "checkbox") {
        if (fieldValue(form, f.name) === "true") d.values[f.name] = "true";
        else delete d.values[f.name];
      } else {
        const v = fieldValue(form, f.name);
        if (v) d.values[f.name] = v;
        else delete d.values[f.name];
      }
    }
  }
  if (action === "back") return redirect(`${PREFIX}/apply/${job.id}/${WORKDAY_PAGES[Math.max(0, index - 1)]!.slug}`);

  if (index !== REVIEW_INDEX) {
    const bad = missing(spec, d);
    if (bad.length) return applicationPage(job, index, d, bad);
    d.completed = Math.max(d.completed, index + 1);
    return redirect(`${PREFIX}/apply/${job.id}/${WORKDAY_PAGES[index + 1]!.slug}`);
  }

  // Review → Submit: re-validate every page, then record the whole application.
  const all = FORM_PAGES.flatMap((p) => missing(p, d));
  if (all.length) return applicationPage(job, index, d, all);
  const sub = ctx.record({
    ats: "workday",
    board: board.token,
    jobId: job.id,
    parsed: { fields: { "account--email": email, ...d.values }, files: { ...d.files } },
  });
  d.submissionId = sub.id;
  return redirect(`${PREFIX}/apply/${job.id}/confirmation`);
}

// ------------------------------------------------------------------ router

export async function handleWorkday(ctx: Ctx): Promise<Reply | undefined> {
  const path = ctx.path;
  if (!path.startsWith("/workday/")) return undefined;

  // Test helper: marks an account verified, like clicking the link in the verification email.
  if (path === "/workday/__verify" && ctx.method === "GET") {
    const acct = stateOf(ctx).accounts.get((ctx.query.get("email") ?? "").toLowerCase());
    if (!acct) return htmlReply(404, page("Unknown account", "<h1>Unknown account</h1>"));
    acct.verified = true;
    return htmlReply(200, page("Email verified", "<h1>Email verified</h1>"));
  }

  if (path === PREFIX || path === `${PREFIX}/`) return listingPage();

  const posting = new RegExp(`^${PREFIX}/job/([^/]+)/([^/]+)_([^/_]+)(?:/(apply)(?:/(applyManually))?)?/?$`).exec(path);
  if (posting) {
    const job = jobById(posting[3]!);
    if (!job || job.closed) return notFound();
    if (ctx.method !== "GET") return undefined;
    if (!posting[4]) return postingPage(job);
    if (!posting[5]) return applyChoicePage(job);
    return redirect(sessionEmail(ctx) ? `${PREFIX}/apply/${job.id}/${WORKDAY_PAGES[0]!.slug}` : `${PREFIX}/login/${job.id}`);
  }

  const login = new RegExp(`^${PREFIX}/login/([^/]+)/?$`).exec(path);
  if (login) {
    const job = jobById(login[1]!);
    return job && !job.closed ? handleAuth(ctx, job) : notFound();
  }

  const app = new RegExp(`^${PREFIX}/apply/([^/]+)/([A-Za-z]+)/?$`).exec(path);
  if (app) {
    const job = jobById(app[1]!);
    return job && !job.closed ? handleApplication(ctx, job, app[2]!) : notFound();
  }
  return undefined;
}

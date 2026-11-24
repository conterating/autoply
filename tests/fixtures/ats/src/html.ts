import type { Reply } from "./core.ts";

export const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const htmlReply = (status: number, body: string): Reply => ({
  status,
  type: "text/html; charset=utf-8",
  body,
});

export const jsonReply = (status: number, data: unknown): Reply => ({
  status,
  type: "application/json; charset=utf-8",
  body: JSON.stringify(data),
});

/** Visible required marker; the input carries required/aria-required for assistive tech. */
export const REQ = `<span class="req" aria-hidden="true">*</span>`;

export const BASE_CSS = `
body{font:16px/1.5 system-ui,sans-serif;margin:0;color:#1a1a1a;background:#fafafa}
main{max-width:720px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:28px;margin:8px 0}h2{font-size:20px;margin-top:32px}
.field,.question{margin:16px 0}
label,legend{display:block;font-weight:600;margin-bottom:4px}
input[type=text],input[type=email],input[type=tel],input[type=url],textarea,select{width:100%;box-sizing:border-box;padding:8px;border:1px solid #767676;border-radius:4px;font:inherit}
.req{color:#b00020;margin-left:2px}
.option{display:block;font-weight:400;margin:4px 0}
.form-error{border:2px solid #b00020;background:#fdecea;color:#7a0016;padding:12px 16px;border-radius:4px;margin:16px 0}
button,.btn{font:inherit;padding:10px 20px;border-radius:4px;border:1px solid #333;background:#fff;cursor:pointer;margin-right:8px}
button[type=submit]{background:#1a1a1a;color:#fff}
.select{position:relative}
.select__menu{position:absolute;left:0;right:0;z-index:5;margin:2px 0 0;padding:0;list-style:none;background:#fff;border:1px solid #767676;border-radius:4px;max-height:220px;overflow:auto}
.select__menu li{padding:8px 12px;cursor:pointer}.select__menu li:hover,.select__menu li[aria-selected=true]{background:#e8eefc}
.yesno button[aria-pressed=true]{background:#1a1a1a;color:#fff}
.h-captcha{border:1px dashed #767676;padding:8px;margin:16px 0}
[hidden]{display:none!important}
`;

export function layout(o: { title: string; body: string; script?: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title><style>${BASE_CSS}</style></head>
<body><main>${o.body}</main>${o.script ? `<script>${o.script}</script>` : ""}</body></html>`;
}

export function errorBanner(errors: string[]): string {
  if (errors.length === 0) return "";
  return `<div class="form-error" role="alert" id="form-errors"><strong>There were problems with your submission:</strong><ul>${errors
    .map((e) => `<li>${esc(e)}</li>`)
    .join("")}</ul></div>`;
}

/**
 * Reveals/hides wrappers marked `data-depends-on="<field name>" data-depends-value="Yes"`.
 * Hidden inputs are disabled (so they do not post) and not required; shown inputs become required.
 */
export const CONDITIONAL_JS = `
(function(){var form=document.getElementById('application-form');if(!form)return;
function val(n){var els=form.querySelectorAll('[name="'+n+'"]');for(var i=0;i<els.length;i++){var e=els[i];if(e.type==='radio'||e.type==='checkbox'){if(e.checked)return e.value;}else return e.value;}return '';}
function sync(){form.querySelectorAll('[data-depends-on]').forEach(function(w){
var show=val(w.getAttribute('data-depends-on'))===w.getAttribute('data-depends-value');
w.hidden=!show;
w.querySelectorAll('input,textarea,select').forEach(function(i){i.disabled=!show;i.required=show;i.setAttribute('aria-required',String(show));});});}
form.addEventListener('change',sync);sync();})();
`;

export function confirmationPage(o: { heading: string; message: string; jobTitle: string; company: string; submissionId: string }): string {
  return layout({
    title: `${o.heading} - ${o.company}`,
    body: `<h1>${esc(o.heading)}</h1><p>${esc(o.message)}</p><p class="job-title">${esc(o.jobTitle)} at ${esc(o.company)}</p><p>Confirmation ID: <code data-testid="submission-id" id="submission-id">${esc(o.submissionId)}</code></p>`,
  });
}

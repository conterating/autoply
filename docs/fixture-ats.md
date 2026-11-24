# Fixture ATS server

`tests/fixtures/ats` (`@autoply/fixture-ats`). `startFixtureServer({ port: 0 })` → `{ url, port, close(), submissions(), reset() }`; binds 127.0.0.1. `pnpm --filter @autoply/fixture-ats start` runs it on `FIXTURE_PORT` (default 4399). `GET /__submissions`, `POST /__reset`. Each submission has `id` (`FX-0001`), shown on the confirmation page as `<code id="submission-id" data-testid="submission-id">`. Files are in `submission.files[inputName]` (`{ filename, size, contentType }`), not `fields`.

## Boards and variants

| | Greenhouse `northwind` (Northwind Labs) | Lever `contoso` (Contoso Systems) | Ashby `fabrikam` (Fabrikam AI) |
|---|---|---|---|
| ids | `4410001`–`4410007` | `c0ffee01-5a1e-4b0b-9a10-00000000000N` | `ab5b1000-7e57-4a11-8c00-00000000000N` |
| conditionalSponsorship | `4410005` | `…0005` | `…0005` |
| serverError (500, records nothing) | `4410006` | | |
| captcha (never solvable) | | `…0006` | |
| closed (404, not in discovery) | `4410007` | `…0007` | |
| multiPage | | | `…0006` |

`FIXTURE_BOARDS.<ats>.variants.<name>` holds the ids; `FIXTURE_BOARDS.<ats>.postings[]` has `{ id, title, kind, location, country, workplace, … }`.

## Endpoints

- Greenhouse: discovery `GET /greenhouse/boards-api/v1/boards/northwind/jobs?content=true`; form `GET/POST /greenhouse/northwind/jobs/{id}`.
- Lever: discovery `GET /lever/v0/postings/contoso?mode=json`; posting `GET /lever/contoso/{id}`; form `GET/POST /lever/contoso/{id}/apply`.
- Ashby: discovery `GET /ashby/posting-api/job-board/fabrikam?includeCompensation=true`; overview `GET /ashby/fabrikam/{uuid}`; form `GET/POST /ashby/fabrikam/{uuid}/application`.

## Shared DOM conventions

- `<form id="application-form" method=post enctype=multipart/form-data novalidate>`.
- Required fields: `required` + `aria-required="true"` + `<span class="req" aria-hidden="true">*</span>` in the label.
- Server-side validation failure → HTTP 400, form re-rendered blank with `<div class="form-error" role="alert" id="form-errors"><ul><li>Resume is required</li>…` (`"<Label> is required"`).
- Conditional wrapper `<div data-depends-on="<field name>" data-depends-value="Yes" hidden>`; its inputs start `disabled` and become visible/enabled/required when the controlling field is Yes. Labels: "Will you require sponsorship?" → reveals "What visa type will you need?". Work auth label: "Are you legally authorized to work in the United States?".

## Greenhouse

- Plain: `<label for=ID id=ID-label>` + `<input id=ID name=ID>`: `first_name`, `last_name`, `email`, `phone`, `question_40100001` (LinkedIn Profile), `question_40100002` (Website), `question_40100006` (textarea "Why are you interested in Northwind Labs?"), `question_40100005` (conditional visa).
- Files: `input[type=file]#resume` (required, label "Resume/CV"), `#cover_letter` (optional, "Cover Letter").
- Custom comboboxes (all selects incl. EEO): `country`, `question_40100003` (work auth), `question_40100004` (sponsorship), `gender`, `hispanic_ethnicity`, `veteran_status`, `disability_status`. Structure: `<div class="select" data-combobox data-options='[...]'>` with `<label id=ID-label for=ID>`, `<input id=ID type=text role=combobox aria-expanded aria-controls=ID-listbox aria-labelledby=ID-label aria-haspopup=listbox>`, and sibling `<input type=hidden name=ID>`. Click the input (or ArrowDown) → `<ul role=listbox id=ID-listbox>` with `<li role=option id=ID-option-N>`; listbox only exists while open. Click/Enter on an option sets visible text + hidden input (option label) and fires `change` on the hidden input. `selectOption` does not work. Options are in `data-options` JSON on the wrapper (usable for extraction without opening).
- Submit `<button type=submit>Submit application</button>`; success page "Thank you for applying." + job title.

## Lever

- `name` (id `name`, "Full name"), `email`, `phone`, `location` ("Current location"), `org`; `urls[LinkedIn|GitHub|Portfolio]` with ids `urls_LinkedIn` etc.; resume `input[type=file]#resume-upload-input[name=resume]` (required, "Resume/CV"); `comments` textarea ("Additional information").
- Cards `name="cards[<uuid>][field0]"`, uuids `a1b2c3d4-000N-4000-8000-00000000000N`: 0001 radio work auth, 0002 radio sponsorship, 0003 conditional visa text, 0004 checkbox group "Which languages have you used professionally?" (TypeScript, Python, Go, Java, Rust; repeated values), 0005 required text "Why are you interested in this role?".
- Radio groups `<fieldset role=radiogroup aria-labelledby=LEGEND-ID><legend id=…>`, each radio in `<label for=card-UUID-I>`; ids `card-<uuid>-<i>`; text inputs `card-<uuid>-0`.
- EEO `<select>`s: `eeo[gender]` (#eeo-gender), `eeo[race]` (#eeo-race), `eeo[veteran]` (#eeo-veteran), blank "Select..." first option.
- Submit `#btn-submit` "Submit application"; success "Application submitted!". Posting page has `a.postings-btn.template-btn-submit` "Apply for this job". Closed → 404 "This posting is closed".
- Captcha variant: `<div class="h-captcha" data-sitekey="fixture"><iframe title="hCaptcha challenge">` + hidden `textarea[name=h-captcha-response]`; always rejected.

## Ashby

- `_systemfield_name`, `_systemfield_email`, `_systemfield_phone`, `_systemfield_location`, `_systemfield_resume` (file, required).
- Custom question names `5d0a1c00-0000-4000-8000-00000000000N`: 0001 LinkedIn URL, 0002 work auth (yes/no buttons), 0003 sponsorship (yes/no buttons), 0004 conditional visa text, 0005 languages checkboxes (ids `<uuid>-<i>`, shared name), 0006 required textarea "Why do you want to work here?".
- Yes/no widget: `<div class="yesno" role=group aria-labelledby=UUID-label aria-required=true>` + `<button type=button id=UUID-yes aria-pressed>Yes</button>` `<button type=button id=UUID-no>No</button>` + `<input type=hidden id=UUID name=UUID>`; its `<label id=UUID-label>` has no `for`.
- EEO radio fieldsets: `eeoc_gender`, `eeoc_race`, `eeoc_veteran_status`, `eeoc_disability_status`, radios `id=NAME-I`.
- Submit `#submit-btn` "Submit Application"; success "Your application was successfully submitted".
- Multi-page: `#step-1`, `#next-btn` (validates aria-required client-side, `#step-error`), `#step-2` hidden until Next (EEO + Back + submit). One form posts everything.

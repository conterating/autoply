# Build prompt: Autoply

You are building **Autoply**, a local-first app that finds jobs matching a user's preferences and submits the applications for them, end to end. The user fills in their profile once. After that Autoply discovers postings, writes a tailored cover letter, answers every form question (from "First name" to "Are you a protected veteran?"), submits, and keeps a full record of what it sent.

The target user is someone who needs volume: new grads and job seekers sending hundreds of applications. They care about three things, in this order: applications are never wrong (no false statements under their name), they never have to answer the same question twice, and throughput is high.

Work through the milestones at the bottom in order. Do not start a milestone until the previous one passes its acceptance checks. Commit after each milestone.

## Form factor (decided)

Build a **local web app plus a background worker**, started with one terminal command (`autoply start`), which opens the dashboard at `localhost`.

- Not a browser extension. An extension only runs while the user has a posting open, which is the assist model this product is replacing. Autonomous discovery and submission needs a long-running process that drives its own browser.
- Not a terminal-only tool. Onboarding collects 100+ fields and the user has to review queues, screenshots, and cover letters. That needs a real UI.
- Local, not hosted. The profile contains demographic data, work authorization, and a home address. Keeping it on the user's machine removes a whole class of privacy and security work, and applications go out from the user's own IP and browser.

The CLI is a thin wrapper: `autoply start`, `autoply stop`, `autoply status`, `autoply run --dry-run`, `autoply doctor`.

## Stack

- TypeScript everywhere, pnpm monorepo: `apps/web` (Next.js App Router), `apps/worker` (Node), `packages/core` (profile schema, question resolver, matching), `packages/ats` (one adapter per ATS), `packages/cli`.
- SQLite with Drizzle. File lives in `~/.autoply/`. Uploaded resumes and screenshots live there too.
- Playwright (Chromium, persistent user-data dir) for form filling.
- Tailwind + shadcn/ui for the dashboard.
- Claude API for resume parsing, question classification, and writing. Before writing any API code, load the `claude-api` skill and use it to confirm current model IDs, structured output usage, and prompt caching. Make the model configurable per task; default to a small fast model for classification and a stronger one for cover letters and free-text answers. The API key is read from the environment or entered in Settings and stored in the OS keychain, never in SQLite or logs.
- Zod schemas are the single source of truth for the profile and for every LLM output.
- Vitest for unit and integration tests, Playwright Test for end-to-end.

## Scope of sites

Support these ATS platforms, in this order: **Greenhouse, Lever, Ashby**, then **Workday** as a later milestone. Together they host most tech and new-grad postings, their application forms are public pages, and the first three expose public job-board JSON endpoints for discovery. Look up each endpoint's current shape in its documentation rather than assuming it.

Out of scope, and do not build: scraping or automating LinkedIn, Indeed, or any site that requires logging in to a job-board account and prohibits automation in its terms; CAPTCHA solving or bypass services; fingerprint spoofing or other bot-detection evasion. When a CAPTCHA or unexpected verification step appears, the worker pauses that application, marks it `needs_user`, and the dashboard lets the user open the live browser window to finish it by hand.

Be a polite client: per-domain rate limits, randomized human-scale pacing between applications, a configurable daily cap (default 50), and exponential backoff on errors.

## The profile

Onboarding is a multi-step wizard that starts with resume upload (PDF or DOCX). Parse the resume into structured data, then show every parsed field for the user to confirm or correct. Never trust the parse silently.

Collect all of the following. Each field stores a value and a `confirmed_by_user` flag.

- **Identity and contact:** legal first/middle/last name, preferred name, pronouns, email, phone with country code, full address, city, state, zip, country.
- **Links:** LinkedIn, GitHub, portfolio, personal site, other.
- **Work experience:** per role: company, title, location, start and end dates, current flag, description bullets.
- **Education:** per school: name, degree, major, minor, GPA, start date, graduation date (or expected), honors.
- **Skills, certifications, languages** (with proficiency), publications, projects.
- **Work authorization:** authorized to work in each target country, requires sponsorship now, requires sponsorship in future, visa type, citizenship, security clearance.
- **Preferences:** target titles, seniority, locations, remote/hybrid/onsite, willing to relocate, minimum salary, desired salary, earliest start date, notice period, employment types, companies to exclude, keywords to exclude.
- **Voluntary self-identification (EEO):** gender, race/ethnicity, Hispanic/Latino, veteran status, disability status, sexual orientation, transgender status. Each one offers "Decline to answer" and that is the default.
- **Common screening answers:** over 18, criminal history, previously worked at this company, non-compete agreements, relatives at the company, how did you hear about us, willing to undergo background check, drug test, years of experience per skill.
- **Documents:** one or more resume versions, optional transcript, optional writing samples.
- **Voice:** two or three sentences on tone for cover letters, plus optional past cover letters as style examples.

## The question resolver (the core of the product)

Every form field passes through one pipeline in `packages/core`:

1. **Extract** the field: label, help text, type (text, textarea, select, radio, checkbox, file, date), options, required flag.
2. **Deterministic match** against a canonical question catalog (several hundred normalized phrasings mapped to profile keys). Exact and fuzzy match first; this handles the bulk of fields for free.
3. **LLM classification** when no deterministic match: map the question to a canonical key or to `novel`, returning a confidence score as structured output.
4. **Answer** from the profile. For selects and radios, map the profile value to the closest available option and record which option was chosen and why.
5. **Novel free-text questions** ("Why do you want to work here?", "Describe a hard bug you fixed") are drafted by the LLM using only the profile, the resume, and the job description as source material.
6. **Anything below the confidence threshold goes to the Needs Input queue**, not into the form. When the user answers, save the answer to the Answer Bank keyed by the normalized question so it is never asked again.

Two hard rules, enforced in code and covered by tests:

- **Legal and demographic questions are never answered by the LLM.** Work authorization, sponsorship, EEO, veteran, disability, criminal history, clearance, age, and any attestation or signature field are answered only from values the user explicitly confirmed. The LLM may classify which question is being asked; it may not supply the answer. If the confirmed value is missing or the available options don't map cleanly, the application goes to Needs Input. These are legal statements made under the user's name, and a wrong one can get an offer rescinded.
- **Generated text never invents facts.** Cover letters and free-text answers may only state experience, skills, employers, degrees, and numbers that appear in the profile. Run a second verification pass that extracts factual claims from each generated text and checks each one against the profile; any unsupported claim fails the draft and triggers a regeneration, and a second failure sends it to Needs Input.

## Discovery and matching

- Sources: the public job-board endpoints for a seeded and user-extendable list of companies on Greenhouse, Lever, and Ashby, plus optional ingestion of public community job lists (for example the new-grad and internship lists maintained on GitHub).
- Normalize every posting to one schema, and dedupe on ATS + posting ID and on company + title + location.
- Score each posting against preferences: hard filters first (location, authorization, excluded companies and keywords, seniority), then an LLM relevance score with a short reason.
- Never apply to the same posting twice. Enforce this with a unique constraint in the database, not just application logic.

## Applying

Each ATS adapter implements one interface: `discover()`, `extractForm(page)`, `fill(page, answers)`, `submit(page)`, `confirmSubmitted(page)`.

Application state machine: `discovered → matched → queued → filling → needs_input | needs_user | ready → submitted → confirmed | failed`. Every transition is persisted, so the worker can crash and resume without double-submitting.

Two modes, chosen in Settings:

- **Review** (default): the worker fills everything, takes a full-page screenshot, and waits. The user approves from the dashboard, one at a time or in bulk.
- **Autopilot**: submits without approval only when every required field resolved above threshold, the match score is above the user's bar, and the daily cap has room. Anything else falls back to Review.

For every submitted application store: the exact answer given to every question and where it came from (profile, answer bank, LLM draft), the cover letter, the resume version used, pre-submit and post-submit screenshots, and timestamps. The user must be able to see exactly what was sent in their name.

`--dry-run` runs the whole pipeline and stops before the submit click. It is the default until the user turns it off in Settings.

## Dashboard

Before building any UI, load the `frontend-design` skill and follow it. The product should feel like a calm, fast operations console, closer to Linear than to a marketing template. Dense but readable, keyboard-friendly, dark and light themes, real empty and loading states, responsive down to laptop width.

Screens:

- **Onboarding wizard** with resume upload, parsed-field confirmation, progress indicator, and save-and-resume.
- **Home:** today's counts (found, applied, waiting on you, failed), a cap progress meter, a live worker status with start/pause, and recent activity.
- **Pipeline:** table of every application with status, company, title, match score, filters, search, and bulk approve.
- **Needs Input:** one question at a time, showing the job and the exact form field, with the answer saved to the Answer Bank. Shows how many queued applications each answer unblocks. This is the screen the user visits most, so make it fast.
- **Application detail:** every question and answer with its source, the cover letter, screenshots, and a timeline.
- **Profile** and **Answer Bank** editors.
- **Settings:** mode, caps, pacing, match threshold, sources, API key, export and delete all data.

## Testing

Tests never submit an application to a real employer. That rule has no exceptions; add a guard in the worker that refuses to click submit on a non-localhost origin when `NODE_ENV=test`.

- **Fixture ATS server.** Build a local server in `tests/fixtures/ats` that serves realistic replicas of Greenhouse, Lever, Ashby, and Workday application forms, with the same DOM structure, field types, custom-question patterns, multi-page flows, and confirmation pages, and that records what was submitted so tests can assert on it. Include awkward variants: custom dropdown widgets, required file uploads, conditional fields that appear after another answer, a CAPTCHA placeholder, a form that errors on submit, and a posting that has closed.
- **Resolver golden set.** At least 300 real-world question phrasings in a fixture file, each with the expected canonical key, including many rewordings of the legal and EEO questions. Deterministic matching plus classification must reach 95% or better on the set, with 100% on the legal and demographic subset, where "correct" includes correctly routing to Needs Input. Run the LLM portions against recorded responses in CI and behind a flag against the live API.
- **Hard-rule tests.** Prove that a legal or demographic field with no confirmed value always produces `needs_input`. Prove that a cover letter containing a planted fabricated claim fails verification. Prove that "Decline to answer" is selected when that is the stored value, across every fixture's option wording.
- **Unit tests** for the profile schema, option mapping, dedupe, scoring filters, rate limiter, daily cap, and each state transition.
- **End-to-end tests** with Playwright: full onboarding in the dashboard; discover → match → fill → review → approve → submitted against each fixture ATS, asserting the recorded submission matches the profile field for field; dry-run never posts; Autopilot falls back to Review on a low-confidence field; killing the worker mid-fill and restarting produces exactly one submission; the CAPTCHA fixture ends in `needs_user`.
- **Dashboard checks.** Run an accessibility pass (axe) on every screen, and take screenshots of every screen in both themes and look at them yourself before calling UI work done.
- `pnpm test`, `pnpm test:e2e`, `pnpm lint`, and `pnpm typecheck` all pass before any milestone is called complete. When something fails, fix the cause; do not weaken or skip the test.

## Milestones

1. **Foundation.** Monorepo, database schema, profile Zod schema, CLI skeleton, CI script. Write a `CLAUDE.md` recording commands, architecture, and the hard rules above. *Accept:* `autoply start` serves an empty dashboard; typecheck, lint, and schema tests pass.
2. **Onboarding and profile.** Resume parsing, wizard, profile and Answer Bank editors. *Accept:* e2e test uploads a sample resume and finishes onboarding; every profile field is editable and persisted.
3. **Fixture ATS server and resolver.** *Accept:* golden set thresholds met; hard-rule tests pass.
4. **Greenhouse adapter, end to end in dry-run**, including cover letter generation and claim verification. *Accept:* fixture submission matches profile field for field; application detail screen shows every answer and its source.
5. **Discovery, matching, queue, and the worker state machine**, with Review mode and the Needs Input loop. *Accept:* crash-resume test and never-apply-twice test pass.
6. **Lever and Ashby adapters.** *Accept:* same e2e suite passes for both.
7. **Autopilot, caps, pacing, and the CAPTCHA pause flow.** *Accept:* fallback and cap tests pass.
8. **Dashboard polish.** Full design pass, both themes, accessibility, empty and error states. *Accept:* axe passes clean; you have reviewed screenshots of every screen.
9. **Workday adapter** (multi-page flow, account creation with user-supplied credentials stored in the OS keychain). *Accept:* fixture e2e passes.
10. **Real-world dry run.** With my go-ahead, run `--dry-run` against a handful of live postings per ATS, compare the filled forms to the fixtures, and fix the gaps. Do not submit anything live; I will do the first real submissions myself in Review mode.

At the end of each milestone, report what was built, the test results with real output, and anything you could not verify. If a requirement here turns out to conflict with how a real ATS behaves, stop and tell me rather than quietly working around it.

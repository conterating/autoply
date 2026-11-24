# Autoply

Local-first app that finds jobs matching the user's profile and applies to them. A Next.js dashboard and a Node worker share one SQLite database in `~/.autoply/` (override with `AUTOPLY_HOME`). The full product brief is in `BUILD_PROMPT.md`.

## Commands

```sh
pnpm install                 # pnpm 12 via corepack
pnpm autoply start           # build dashboard if needed, start web + worker, open browser
pnpm autoply stop | status | doctor
pnpm autoply run --dry-run   # one pipeline pass in the foreground
pnpm dev                     # dashboard dev server on :4310
pnpm test                    # vitest (unit + integration)
pnpm test:e2e                # playwright, needs `pnpm build` first
pnpm lint && pnpm typecheck
pnpm ci                      # everything above, in order
pnpm db:generate             # after editing packages/core/src/db/schema.ts
```

`pnpm db:generate` runs drizzle-kit and then `scripts/bundle-migrations.ts`, which inlines the SQL into `packages/core/src/db/migrations.generated.ts`. Migrations are applied on every `openDb()`. Commit both the `drizzle/` SQL and the generated file.

## Layout

- `packages/core`: profile Zod schema (`src/profile/schema.ts`), settings, application state machine (`src/applications/status.ts`), Drizzle schema and queries (`src/db/`), question resolver, matching.
- `packages/ats`: one adapter per ATS behind the `AtsAdapter` interface (`discover`, `extractForm`, `fill`, `submit`, `confirmSubmitted`).
- `packages/cli`: `autoply` command. Thin wrapper; spawns `next start` and the worker detached with pid files in `~/.autoply/run/`.
- `apps/web`: Next.js App Router dashboard. Server components read SQLite directly via `@autoply/core/db`. Console pages live under `src/app/(console)/`.
- `apps/worker`: long-running loop; heartbeats into `worker_state`, obeys `desired` (running/paused) set from the dashboard.
- `tests/fixtures/ats`: local replicas of ATS application forms. `tests/e2e`: Playwright specs.

Workspace packages export TypeScript source directly (no build step); imports use explicit `.ts` extensions inside packages.

## Hard rules (enforced in code, covered by tests; do not weaken)

1. **Legal and demographic questions are never answered by the LLM.** Work authorization, sponsorship, EEO (gender, race, Hispanic/Latino, veteran, disability, orientation, transgender), criminal history, clearance, age, and any attestation or signature field are filled only from profile fields with `confirmedByUser: true`. The LLM may classify the question; it may not supply the answer. Missing or unmappable → `needs_input`.
2. **Generated text never invents facts.** Cover letters and free-text answers may only state experience, skills, employers, degrees and numbers present in the profile. A verification pass extracts claims and checks each against the profile; one failure regenerates, a second sends it to Needs Input.
3. **Never apply to the same posting twice.** `applications.posting_id` is UNIQUE. `submitting` is written before the submit click and is never automatically retried.
4. **Tests never submit to a real employer.** With `NODE_ENV=test` the worker refuses to click submit on any non-localhost origin. Tests use `AUTOPLY_HOME=.test-data/...`, never `~/.autoply`.
5. **No bot-detection evasion.** No CAPTCHA solving, fingerprint spoofing, or automating LinkedIn/Indeed. CAPTCHAs pause the application as `needs_user`.
6. **Dry run is the default** until the user turns it off in Settings. Review mode is the default over Autopilot.
7. The Claude API key lives in the environment or the OS keychain, never in SQLite or logs.

## Profile conventions

Every scalar profile field is `{ value, confirmedByUser }`. List entries (experience, education, ...) have one `confirmedByUser` per entry. EEO fields default to `"decline"` but unconfirmed; onboarding has the user confirm them.

## Dashboard design

"Carbon copy" palette: cool paper, near-black ink, one accent (`--carbon`, carbon-paper blue-violet) reserved for things that are sent or about to be. Type: Archivo (wide, `font-display-wide`) for titles and big numbers, IBM Plex Sans for UI, IBM Plex Mono for counts, IDs and times. Signature element: the `PunchStrip` daily-cap meter. Tokens are CSS variables in `apps/web/src/app/globals.css`; never hard-code colors. Every screen must pass axe (WCAG 2.1 AA) in both themes; e2e `checkScreen()` does this and writes screenshots to `test-results/screens/`.

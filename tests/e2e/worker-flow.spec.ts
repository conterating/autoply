import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { schema } from "../../packages/core/src/db/index.ts";
import { startFixtureServer, type FixtureServer } from "../fixtures/ats/src/index.ts";
import { checkScreen } from "./helpers";
import { configure, e2eDb, seedSources, spawnWorker, waitFor, type WorkerHandle } from "./worker-helpers";

/**
 * The whole product against the fixture ATS server: the dashboard under test,
 * a real worker process, and the profile created by onboarding.spec.ts.
 * discover → match → fill → Needs input → review → approve → submitted.
 */
test.describe.configure({ mode: "serial" });

let fixture: FixtureServer;
let worker: WorkerHandle;
const db = () => e2eDb();

test.beforeAll(async () => {
  fixture = await startFixtureServer({ port: 0 });
  const d = db();
  seedSources(d);
  configure(d, { dryRun: false, mode: "review" });
  worker = spawnWorker(fixture.url);
});

test.afterAll(async () => {
  await worker?.stop();
  await fixture?.close();
});

const statuses = () => db().select({ id: schema.applications.id, status: schema.applications.status }).from(schema.applications).all();
const countIn = (s: string[]) => statuses().filter((a) => s.includes(a.status)).length;
const settled = () => countIn(["queued", "filling", "discovered", "matched"]) === 0;

/** Answers every question in Needs input through the UI. */
async function answerAllQuestions(page: Page) {
  for (let i = 0; i < 25; i++) {
    await page.goto("/needs-input");
    if (await page.getByText("Nothing needs you right now").isVisible()) return;
    const question = (await page.locator("#question-label").textContent())?.trim() ?? "";
    const group = page.getByRole("group", { name: "Answers" });
    if (await group.isVisible()) {
      const preferred = group.getByRole("button", { name: /TypeScript/ });
      await ((await preferred.count()) ? preferred.first() : group.getByRole("button").first()).click();
    } else {
      const text = /visa/i.test(question)
        ? "H-1B"
        : "I build TypeScript services and test suites, which matches this role's focus on reliable backend work.";
      await page.getByLabel("Your answer").fill(text);
      await page.getByRole("button", { name: "Save answer" }).click();
    }
    // Either the next question replaces this one or the queue empties.
    await expect
      .poll(async () => {
        if (await page.getByText("Nothing needs you right now").isVisible()) return "done";
        if (await page.getByRole("status").filter({ hasText: /Saved/ }).isVisible()) return "saved";
        return ((await page.locator("#question-label").textContent())?.trim() ?? "") !== question ? "next" : "same";
      })
      .not.toBe("same");
  }
  throw new Error("Needs input never emptied");
}

test("start applying, answer Needs input, approve, and send", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await page.getByRole("button", { name: "Start applying" }).click();
  await expect(page.getByRole("button", { name: "Pause applying" })).toBeVisible();

  // Discovery + matching + filling run in the worker.
  await waitFor(() => statuses().length > 0 && settled(), 120_000);
  const afterFirstPass = statuses();
  expect(afterFirstPass.length).toBeGreaterThan(0);
  expect(countIn(["needs_input", "ready"])).toBeGreaterThan(0);

  await page.goto("/pipeline");
  await checkScreen(page, "pipeline");

  await page.goto("/needs-input");
  if (await page.locator("#question-label").isVisible()) await checkScreen(page, "needs-input");
  await answerAllQuestions(page);

  // Answered applications go back through the worker and come out ready.
  await waitFor(() => settled() && countIn(["needs_input"]) === 0 && countIn(["ready"]) > 0, 120_000);
  const ready = statuses().filter((a) => a.status === "ready").map((a) => a.id);

  await page.goto("/pipeline?status=ready");
  await page.getByRole("checkbox", { name: /Select all/i }).check();
  await page.getByRole("button", { name: /Approve and send/ }).click();

  await waitFor(() => {
    const rows = db().select({ status: schema.applications.status }).from(schema.applications).where(inArray(schema.applications.id, ready)).all();
    return rows.every((r) => ["confirmed", "submitted", "failed", "needs_user"].includes(r.status));
  }, 120_000);

  const sent = db()
    .select()
    .from(schema.applications)
    .innerJoin(schema.postings, eq(schema.postings.id, schema.applications.postingId))
    .where(inArray(schema.applications.id, ready))
    .all();
  const confirmed = sent.filter((r) => r.applications.status === "confirmed");
  expect(confirmed.length).toBeGreaterThan(0);

  // Exactly one recorded submission per confirmed application, carrying the profile's answers.
  const subs = fixture.submissions();
  for (const row of confirmed) {
    const mine = subs.filter((s) => s.ats === row.postings.ats && s.jobId === row.postings.externalId);
    expect(mine, `${row.postings.ats} ${row.postings.title}`).toHaveLength(1);
    const values = Object.values(mine[0]!.fields).flat().join(" | ");
    expect(values).toContain("jordan.rivera@example.com");
    expect(values).toMatch(/Jordan/);
    expect(Object.values(mine[0]!.files).map((f) => f.filename)).toContain("sample-resume.pdf");
  }

  // Application detail shows every answer, its source, screenshots and the timeline.
  await page.goto(`/applications/${confirmed[0]!.applications.id}`);
  await expect(page.getByText("From profile").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /screenshot of the application form/i }).first()).toBeVisible();
  await expect(page.getByText(/confirmed/i).first()).toBeVisible();
  await checkScreen(page, "application-detail");
});

test("killing the worker mid-fill and restarting produces exactly one submission", async ({ page }) => {
  test.setTimeout(240_000);
  const d = db();
  // Re-open a posting that was skipped (or pick any posting without a sent application) for a fresh attempt.
  const candidate = d
    .select()
    .from(schema.applications)
    .innerJoin(schema.postings, eq(schema.postings.id, schema.applications.postingId))
    .where(eq(schema.applications.status, "skipped"))
    .all()
    .find((r) => r.postings.ats !== "lever" || !/captcha/i.test(r.postings.title));
  test.skip(!candidate, "No skipped posting available to retry");
  const appId = candidate!.applications.id;
  const { transition } = await import("../../packages/core/src/applications/transition.ts");
  transition(d, appId, "matched", "Re-queued by test", { matchScore: 90 });
  transition(d, appId, "queued", "Re-queued by test");

  await waitFor(() => d.select().from(schema.applications).where(eq(schema.applications.id, appId)).get()?.status === "filling", 60_000, 50);
  await worker.stop("SIGKILL");
  worker = spawnWorker(fixture.url);

  await waitFor(() => ["needs_input", "ready", "failed", "needs_user"].includes(d.select().from(schema.applications).where(eq(schema.applications.id, appId)).get()!.status), 120_000);
  await answerAllQuestions(page);
  await waitFor(() => d.select().from(schema.applications).where(eq(schema.applications.id, appId)).get()?.status === "ready", 120_000);

  await page.goto(`/applications/${appId}`);
  await page.getByRole("button", { name: "Approve and send" }).click();
  await waitFor(() => ["confirmed", "submitted"].includes(d.select().from(schema.applications).where(eq(schema.applications.id, appId)).get()!.status), 120_000);

  const events = d.select().from(schema.applicationEvents).where(eq(schema.applicationEvents.applicationId, appId)).all();
  expect(events.some((e) => e.fromStatus === "filling" && e.toStatus === "queued")).toBe(true);
  const subs = fixture.submissions().filter((s) => s.ats === candidate!.postings.ats && s.jobId === candidate!.postings.externalId);
  expect(subs).toHaveLength(1);
});

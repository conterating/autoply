import { expect, test, type Page } from "@playwright/test";
import { checkScreen } from "./helpers";

const RESUME = "tests/fixtures/resumes/sample-resume.pdf";

async function saveAndContinue(page: Page, nextHeading: string) {
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: nextHeading })).toBeVisible();
}

const choose = (page: Page, group: string | RegExp, option: string) =>
  page.getByRole("group", { name: group }).locator("label").filter({ hasText: new RegExp(`^${option}$`) }).click();

test.describe.configure({ mode: "serial" });

test("onboarding: upload a resume and finish every step", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Start with your resume" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Upload your resume" })).toBeVisible();
  await checkScreen(page, "onboarding-resume");

  await page.locator("#resume-file").setInputFiles(RESUME);
  await expect(page.getByText("found 2 jobs, 1 school and 7 skills")).toBeVisible();
  await page.getByRole("button", { name: "Check what was found" }).click();

  // Contact: parsed values are pre-filled and flagged until saved.
  await expect(page.getByRole("heading", { level: 1, name: "Name and contact" })).toBeVisible();
  await expect(page.getByLabel(/Legal first name/)).toHaveValue("Jordan");
  await expect(page.getByLabel(/Legal last name/)).toHaveValue("Rivera");
  await expect(page.getByLabel(/^Email/)).toHaveValue("jordan.rivera@example.com");
  await expect(page.getByLabel("LinkedIn")).toHaveValue("https://linkedin.com/in/jordan-rivera-dev");
  await expect(page.getByText("From resume").first()).toBeVisible();
  await checkScreen(page, "onboarding-identity");
  await page.getByLabel("Street address").fill("100 Congress Ave");
  await page.getByLabel(/ZIP/).fill("78701");
  await saveAndContinue(page, "Work experience");

  // Experience: both parsed jobs, expanded because unconfirmed.
  await expect(page.getByText("Software Engineer Intern · Northwind Labs")).toBeVisible();
  await expect(page.getByText("Teaching Assistant · UT Austin Department of Computer Science")).toBeVisible();
  await checkScreen(page, "onboarding-experience");
  await saveAndContinue(page, "Education");

  await expect(page.getByText("University of Texas at Austin")).toBeVisible();
  await saveAndContinue(page, "Skills and more");

  await expect(page.getByRole("button", { name: "Remove TypeScript" })).toBeVisible();
  await saveAndContinue(page, "Work authorization");

  // Authorization: required legal answers can't be skipped.
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("Answer yes or no for every country, or remove it.")).toBeVisible();
  await choose(page, /Legally authorized to work in US/, "Yes");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("Sponsorship now is required")).toBeVisible();
  await choose(page, /require visa sponsorship to work/, "No");
  await choose(page, /require sponsorship in the future/, "No");
  await checkScreen(page, "onboarding-authorization");
  await saveAndContinue(page, "Job preferences");

  await page.getByLabel("Job titles").fill("Software Engineer");
  await page.getByLabel("Job titles").press("Enter");
  await choose(page, "Seniority", "Entry level / new grad");
  await choose(page, "Workplace", "Remote");
  await page.getByLabel("Locations").fill("Austin, TX");
  await page.getByLabel("Locations").press("Enter");
  await page.getByLabel("Minimum salary").fill("90000");
  await saveAndContinue(page, "Voluntary self-identification");

  // EEO defaults to decline; saving confirms them.
  await expect(page.getByRole("group", { name: "Veteran status" }).getByRole("radio", { name: "Decline to answer" })).toBeChecked();
  await checkScreen(page, "onboarding-eeo");
  await saveAndContinue(page, "Screening questions");

  await choose(page, "Are you 18 or older?", "Yes");
  await choose(page, "Willing to undergo a background check?", "Yes");
  await saveAndContinue(page, "Cover letter voice");

  await page.getByLabel("Tone").fill("Direct and specific. Lead with results.");
  await saveAndContinue(page, "Review and finish");

  await expect(page.getByText("Jordan Rivera")).toBeVisible();
  await expect(page.getByText("US: Yes")).toBeVisible();
  await checkScreen(page, "onboarding-review");
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Set up your profile" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start applying" })).toBeVisible();
});

test("profile: every section is editable and edits persist", async ({ page }) => {
  await page.goto("/profile?section=identity");
  await page.getByLabel("Preferred name").fill("Jo");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Preferred name")).toHaveValue("Jo");
  await checkScreen(page, "profile-identity");

  // Change a legal answer and confirm it sticks.
  await page.goto("/profile?section=authorization");
  await choose(page, /require sponsorship in the future/, "Yes");
  await page.getByLabel("Current visa or status").fill("F-1 OPT");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("group", { name: /require sponsorship in the future/ }).getByRole("radio", { name: "Yes" })).toBeChecked();
  await expect(page.getByLabel("Current visa or status")).toHaveValue("F-1 OPT");

  // Add a job by hand.
  await page.goto("/profile?section=experience");
  await page.getByRole("button", { name: "Add a job" }).click();
  await page.getByLabel(/Job title/).last().fill("Barista");
  await page.getByLabel(/Company/).last().fill("Bean There");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Barista · Bean There")).toBeVisible();

  // Skills, EEO and voice.
  await page.goto("/profile?section=skills");
  await page.getByRole("button", { name: "Remove Git" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove Git" })).toHaveCount(0);

  await page.goto("/profile?section=eeo");
  await choose(page, "Veteran status", "I am not a protected veteran");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("group", { name: "Veteran status" }).getByRole("radio", { name: "I am not a protected veteran" })).toBeChecked();

  for (const section of ["documents", "education", "preferences", "screening", "voice"]) {
    await page.goto(`/profile?section=${section}`);
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
  }
  await page.goto("/profile?section=documents");
  const row = page.getByRole("listitem").filter({ hasText: "sample-resume.pdf" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Default", { exact: true })).toBeVisible();
  await checkScreen(page, "profile-documents");
});

test("answer bank: add, edit and delete an answer", async ({ page }) => {
  await page.goto("/answers");
  await expect(page.getByText("No saved answers yet")).toBeVisible();
  await checkScreen(page, "answers-empty");
  await page.getByRole("button", { name: "Add an answer" }).click();
  await page.getByLabel("Question", { exact: true }).fill("Why are you interested in this role?");
  await page.getByLabel("Answer", { exact: true }).fill("It matches my backend experience.");
  await page.getByRole("button", { name: "Save answer" }).click();
  await expect(page.getByText("It matches my backend experience.")).toBeVisible();

  await page.getByRole("button", { name: /Edit answer to/ }).click();
  await page.getByLabel("Answer", { exact: true }).fill("It matches my TypeScript backend experience.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.reload();
  await expect(page.getByText("It matches my TypeScript backend experience.")).toBeVisible();
  await checkScreen(page, "answers-list");

  await page.getByRole("button", { name: /Delete answer to/ }).click();
  await expect(page.getByText("No saved answers yet")).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { checkScreen } from "./helpers";

test("empty dashboard loads with setup prompt and empty states", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Home · Autoply");
  await expect(page.getByRole("heading", { name: "Set up your profile" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("meter", { name: "Applications sent today" })).toHaveAttribute(
    "aria-valuetext",
    "0 of 50",
  );
  await expect(page.getByText("No activity yet")).toBeVisible();
  await checkScreen(page, "home-empty");
});

test("keyboard shortcuts move between sections", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page).toHaveURL(/\/pipeline$/);
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await expect(page).toHaveURL(/\/$/);
});

test("theme switch persists across reloads", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radio", { name: "Light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("every screen has a real empty state and passes axe in both themes", async ({ page }) => {
  const screens: [string, string, RegExp][] = [
    ["/pipeline", "pipeline-empty", /No applications yet/],
    ["/needs-input", "needs-input-empty", /Nothing needs you right now/],
    ["/profile", "profile-empty", /No profile yet/],
    ["/answers", "answers-empty-shell", /No saved answers yet/],
    ["/settings", "settings", /Claude API key/],
    ["/applications/999999", "not-found", /Nothing here/],
  ];
  for (const [path, name, text] of screens) {
    await page.goto(path);
    await expect(page.getByText(text).first()).toBeVisible();
    await checkScreen(page, name);
  }
});

test("console works at laptop width", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const path of ["/", "/pipeline", "/settings"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls horizontally`).toBeLessThanOrEqual(0);
  }
  await page.goto("/settings");
  await page.screenshot({ path: "test-results/screens/settings-1024.png", fullPage: true });
});

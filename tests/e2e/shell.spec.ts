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

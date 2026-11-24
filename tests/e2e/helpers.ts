import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    localStorage.setItem("autoply-theme", t);
    document.documentElement.dataset.theme = t;
  }, theme);
}

/** Fails on any WCAG 2.1 A/AA violation. */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes
        .map((n) => `${n.target.join(" ")} — ${n.any[0]?.message ?? n.failureSummary ?? ""}`)
        .join("\n  ")}`,
  );
  expect(summary, summary.join("\n")).toEqual([]);
}

/** Screenshots in both themes plus an axe pass in each. */
export async function checkScreen(page: Page, name: string) {
  // Reduced motion disables color transitions, so axe never samples a color mid-fade.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    await page.waitForTimeout(100);
    await expectAccessible(page);
    await page.screenshot({ path: `test-results/screens/${name}-${theme}.png`, fullPage: true });
  }
}

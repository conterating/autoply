import { ensureDataDirs } from "@autoply/core/paths";
import { chromium, type BrowserContext } from "playwright";

/**
 * The worker drives its own Chromium with a persistent profile in
 * ~/.autoply/browser, so sign-ins (e.g. Workday accounts) persist. It runs
 * headed by default so the user can step in when an application needs them;
 * tests run headless. No fingerprint spoofing or bot-detection evasion.
 */
export async function openBrowser(opts: { headless?: boolean; userDataDir?: string } = {}): Promise<BrowserContext> {
  const headless = opts.headless ?? (process.env.AUTOPLY_HEADLESS === "1" || process.env.NODE_ENV === "test" || process.env.AUTOPLY_TEST === "1");
  const context = await chromium.launchPersistentContext(opts.userDataDir ?? ensureDataDirs().browserProfile, {
    headless,
    viewport: { width: 1280, height: 900 },
  });
  // The worker runs under tsx, whose esbuild transform wraps functions in a
  // `__name(...)` helper. Functions passed to page.evaluate are serialized with
  // that call, so define a no-op in every page.
  await context.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
  return context;
}

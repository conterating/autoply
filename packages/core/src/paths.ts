import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * All user data lives under one directory: ~/.autoply by default, overridable
 * with AUTOPLY_HOME (tests always set it to a throwaway directory).
 */
export function autoplyHome(): string {
  return process.env.AUTOPLY_HOME ?? join(homedir(), ".autoply");
}

export function dataPaths(home = autoplyHome()) {
  return {
    home,
    db: join(home, "autoply.db"),
    documents: join(home, "documents"),
    screenshots: join(home, "screenshots"),
    browserProfile: join(home, "browser"),
    run: join(home, "run"),
    logs: join(home, "logs"),
  };
}

export function ensureDataDirs(home = autoplyHome()) {
  const paths = dataPaths(home);
  for (const dir of [paths.home, paths.documents, paths.screenshots, paths.browserProfile, paths.run, paths.logs]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return paths;
}

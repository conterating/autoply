import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@autoply/core", "@autoply/ats"],
  serverExternalPackages: ["better-sqlite3", "playwright", "@napi-rs/keyring"],
  poweredByHeader: false,
  devIndicators: false,
};

export default config;

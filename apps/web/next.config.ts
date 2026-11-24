import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@autoply/core", "@autoply/ats"],
  serverExternalPackages: ["better-sqlite3", "playwright", "@napi-rs/keyring"],
  poweredByHeader: false,
  experimental: {
    // Resumes and transcripts up to 10 MB go through server actions.
    serverActions: { bodySizeLimit: "12mb" },
  },
  devIndicators: false,
};

export default config;

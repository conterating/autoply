#!/usr/bin/env bash
# Everything that must pass before a milestone is called complete.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ typecheck" && pnpm typecheck
echo "▸ lint"      && pnpm lint
echo "▸ unit"      && pnpm test
echo "▸ build"     && pnpm build
echo "▸ e2e"       && pnpm test:e2e
echo "✓ all checks passed"

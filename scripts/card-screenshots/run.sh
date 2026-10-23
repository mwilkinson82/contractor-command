#!/usr/bin/env bash
# Screenshots of Athena's native cards (contract terms, SOV, morning brief) from job 2701 fixture data.
# Same view Claude loads (ui://athena/native-card.html), driven by a minimal MCP Apps host. No backend calls.
#   scripts/card-screenshots/run.sh [out-dir]
# Uses the local Google Chrome. PW_CHANNEL=chromium uses Playwright's Chromium (npx playwright install chromium).
# Playwright is installed in a cache folder, not in the app's dependencies.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-artifacts/card-screenshots}"
PW_HOME="${XDG_CACHE_HOME:-$HOME/.cache}/athena-card-screenshots"

if [ ! -d "$PW_HOME/node_modules/playwright" ]; then
  npm install --silent --prefix "$PW_HOME" playwright@1.48.2 >/dev/null
fi
npx -y bun@1.2.22 scripts/card-screenshots/build.ts "$OUT" >/dev/null
NODE_PATH="$PW_HOME/node_modules" node scripts/card-screenshots/shoot.cjs "$OUT" "${PW_CHANNEL:-chrome}"

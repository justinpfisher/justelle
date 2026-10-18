#!/usr/bin/env bash
set -euo pipefail
fixture="$(node ../tests/seed-emulator.mjs)"
node ../ai/server.mjs >/dev/null 2>&1 &
gateway_pid=$!
cleanup(){ kill "$gateway_pid" 2>/dev/null || true; rm -f "$fixture"; }
trap cleanup EXIT
node ../tests/browser.mjs "$fixture"

#!/usr/bin/env bash
set -euo pipefail
fixture="$(node ../tests/seed-emulator.mjs)"
gateway_log="$(mktemp)"
node ../ai/server.mjs >"$gateway_log" 2>&1 &
gateway_pid=$!
cleanup(){
  local result=$?
  kill "$gateway_pid" 2>/dev/null || true
  if [[ "$result" -ne 0 ]]; then
    grep -F 'Fictional planner test error' "$gateway_log" | tail -n 5 || true
  fi
  rm -f "$fixture" "$gateway_log"
}
trap cleanup EXIT
node ../tests/browser.mjs "$fixture"

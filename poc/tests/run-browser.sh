#!/usr/bin/env bash
set -euo pipefail
fixture="$(timeout 70s node ../tests/seed-emulator.mjs)"
timeout 120s node ../tests/browser.mjs "$fixture"

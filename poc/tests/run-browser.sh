#!/usr/bin/env bash
set -euo pipefail
fixture="$(node ../tests/seed-emulator.mjs)"
node ../tests/browser.mjs "$fixture"

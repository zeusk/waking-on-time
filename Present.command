#!/bin/zsh
# Double-click to present: serves the exported deck from out/ and opens it in your browser.
cd "$(dirname "$0")"
[[ -d out ]] || npm run export
node scripts/serve.mjs

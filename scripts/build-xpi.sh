#!/bin/bash
# Packs extension/ into dist/trusttunnel-firefox-<version>.xpi (unsigned).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/extension/manifest.json")"
mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/trusttunnel-firefox-$VERSION.xpi"
rm -f "$OUT"
(cd "$ROOT/extension" && zip -qr -X "$OUT" . -x '.*' -x '__MACOSX*')
echo "$OUT"

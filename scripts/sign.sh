#!/bin/bash
# Signs extension/ on addons.mozilla.org as an unlisted add-on.
# Asks for the AMO API credentials (hidden input) unless WEB_EXT_API_KEY /
# WEB_EXT_API_SECRET are already set. Keys: https://addons.mozilla.org/developers/addon/api/key/
# Signed .xpi goes to web-ext-artifacts/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "${WEB_EXT_API_KEY:-}" ]; then
  read -r -s -p "JWT issuer (user:...): " WEB_EXT_API_KEY; echo
fi
if [ -z "${WEB_EXT_API_SECRET:-}" ]; then
  read -r -s -p "JWT secret: " WEB_EXT_API_SECRET; echo
fi
if [ -z "$WEB_EXT_API_KEY" ] || [ -z "$WEB_EXT_API_SECRET" ]; then
  echo "Both JWT issuer and JWT secret are required." >&2
  exit 1
fi
export WEB_EXT_API_KEY WEB_EXT_API_SECRET

npx --yes web-ext@8 sign --source-dir extension --artifacts-dir web-ext-artifacts --channel unlisted "$@"
ls -1 web-ext-artifacts/*.xpi

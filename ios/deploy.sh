#!/bin/bash
# Build the app, install it on an iPhone and open it.
#
#   ./deploy.sh                    the first iPhone that is connected and paired
#   ./deploy.sh "Heyang’s iPhone"  a particular one, by name or identifier
#
# The phone has to be unlocked, paired with this Mac and in Developer Mode
# (Settings › Privacy & Security › Developer Mode). By cable or on the same
# network, either works.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIGURATION="${CONFIGURATION:-Debug}"
BUNDLE_ID="com.gcc3.rab"
APP="$ROOT/build/Build/Products/$CONFIGURATION-iphoneos/rab.app"

DEVICE="${1:-}"
if [ -z "$DEVICE" ]; then
  LIST="$(mktemp)"
  trap 'rm -f "$LIST"' EXIT
  xcrun devicectl list devices --json-output "$LIST" >/dev/null
  DEVICE="$(python3 - "$LIST" <<'PY'
import json, sys
for d in json.load(open(sys.argv[1]))["result"]["devices"]:
    hardware = d.get("hardwareProperties", {})
    connection = d.get("connectionProperties", {})
    if (hardware.get("platform") == "iOS"
            and hardware.get("reality") == "physical"
            and connection.get("pairingState") == "paired"
            and connection.get("tunnelState") != "unavailable"):
        print(d["identifier"])
        break
PY
)"
  if [ -z "$DEVICE" ]; then
    echo "No iPhone found — connect one, unlock it and trust this Mac." >&2
    echo "See what is there with: xcrun devicectl list devices" >&2
    exit 1
  fi
fi

"$ROOT/build.sh" device

echo "Installing on $DEVICE..."
xcrun devicectl device install app --device "$DEVICE" "$APP"

echo "Opening..."
xcrun devicectl device process launch --device "$DEVICE" --terminate-existing "$BUNDLE_ID"

echo "rab is on the phone."

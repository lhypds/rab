#!/bin/bash
# Build the app and run it in the iOS simulator.
#
#   ./emulate.sh               the simulator already running, else an iPhone 17
#   ./emulate.sh "iPhone Air"  a particular one, by name or identifier
#
# The simulator has no camera; use the photo button there.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIGURATION="${CONFIGURATION:-Debug}"
BUNDLE_ID="com.gcc3.rab"
APP="$ROOT/build/Build/Products/$CONFIGURATION-iphonesimulator/rab.app"

# The identifier of a simulator: $1 is a name or an identifier, $2 a state to
# require ("Booted") or nothing. Newest iOS first when a name has several.
find_simulator() {
  xcrun simctl list devices available --json | python3 -c '
import json, sys
want, state = sys.argv[1], sys.argv[2]
runtimes = json.load(sys.stdin)["devices"]
def version(runtime):
    return [int(n) for n in runtime.rsplit("iOS-", 1)[-1].split("-") if n.isdigit()]
for runtime in sorted((r for r in runtimes if "iOS" in r), key=version, reverse=True):
    for d in runtimes[runtime]:
        if want and want not in (d["name"], d["udid"]):
            continue
        if state and d["state"] != state:
            continue
        print(d["udid"])
        sys.exit()
' "$1" "$2"
}

if [ -n "$1" ]; then
  SIMULATOR="$(find_simulator "$1" "")"
else
  SIMULATOR="$(find_simulator "" Booted)"
  [ -n "$SIMULATOR" ] || SIMULATOR="$(find_simulator "iPhone 17" "")"
  [ -n "$SIMULATOR" ] || SIMULATOR="$(find_simulator "" "")"
fi
if [ -z "$SIMULATOR" ]; then
  echo "No simulator found${1:+ called \"$1\"}." >&2
  echo "See what is there with: xcrun simctl list devices available" >&2
  exit 1
fi

"$ROOT/build.sh" sim

echo "Starting the simulator..."
xcrun simctl bootstatus "$SIMULATOR" -b >/dev/null
open -a Simulator --args -CurrentDeviceUDID "$SIMULATOR"

echo "Installing..."
xcrun simctl install "$SIMULATOR" "$APP"
xcrun simctl launch --terminate-running-process "$SIMULATOR" "$BUNDLE_ID"

echo "rab is running in the simulator."

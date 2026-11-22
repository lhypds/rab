#!/bin/bash
# Build the iPhone app.
#
#   ./build.sh            for the simulator (the default)
#   ./build.sh device     for a real iPhone, signed
#
# The app lands in ios/build/Build/Products/<configuration>-<sdk>/rab.app.
# CONFIGURATION=Release builds a release; DEVELOPMENT_TEAM=<id> picks the
# signing team when the one found in the keychain is not the one wanted.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-sim}"
CONFIGURATION="${CONFIGURATION:-Debug}"

case "$TARGET" in
  sim|simulator|emulator)
    echo "Building for the simulator ($CONFIGURATION)..."
    xcodebuild -project "$ROOT/rab.xcodeproj" -scheme rab \
      -configuration "$CONFIGURATION" \
      -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath "$ROOT/build" \
      -quiet build
    echo "Built $ROOT/build/Build/Products/$CONFIGURATION-iphonesimulator/rab.app"
    ;;

  device|iphone)
    # The team is the organisational unit of the Apple Development certificate.
    TEAM="${DEVELOPMENT_TEAM:-}"
    if [ -z "$TEAM" ]; then
      TEAM="$(security find-certificate -c 'Apple Development' -p 2>/dev/null \
        | openssl x509 -noout -subject -nameopt multiline 2>/dev/null \
        | awk -F'= ' '/organizationalUnitName/ { print $2; exit }')"
    fi
    if [ -z "$TEAM" ]; then
      echo "No signing team found — sign in to Xcode (Settings › Accounts)," >&2
      echo "or run with DEVELOPMENT_TEAM=<team id>." >&2
      exit 1
    fi

    echo "Building for iPhone ($CONFIGURATION, team $TEAM)..."
    xcodebuild -project "$ROOT/rab.xcodeproj" -scheme rab \
      -configuration "$CONFIGURATION" \
      -destination 'generic/platform=iOS' \
      -derivedDataPath "$ROOT/build" \
      -allowProvisioningUpdates \
      DEVELOPMENT_TEAM="$TEAM" \
      -quiet build
    echo "Built $ROOT/build/Build/Products/$CONFIGURATION-iphoneos/rab.app"
    ;;

  *)
    echo "usage: $0 [sim|device]" >&2
    exit 1
    ;;
esac

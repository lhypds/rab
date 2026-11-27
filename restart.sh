#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Restarting..."

cd "$ROOT"
echo "Pulling latest code..."
git pull --ff-only

# Create .env from .env.example if not present
if [ ! -f "$ROOT/.env" ]; then
  echo "Creating .env from .env.example..."
  cp "$ROOT/.env.example" "$ROOT/.env"
fi

# Install pm2 globally if not present
if ! command -v pm2 &> /dev/null; then
  echo "Installing pm2..."
  npm install -g pm2
fi

if command -v pnpm &> /dev/null; then
  PKG=pnpm
else
  PKG=npm
fi

echo "Installing dependencies with $PKG..."
"$PKG" install

# The server is stopped before the build, not after: it holds every item in
# memory, and on a small machine the build is killed for want of what it
# holds (exit code 137). Where the build fails, the server is started again
# on the dist/ there was.
"$ROOT/stop.sh"

echo "Building frontend..."
if ! "$PKG" run build; then
  echo "The build failed; starting again on the dist/ there was." >&2
  "$ROOT/start.sh"
  exit 1
fi

"$ROOT/start.sh"

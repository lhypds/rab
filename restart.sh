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

# What the frontend is built from: the sources as git has them, and the
# VITE_ settings in .env, which the build writes into it. Where dist/ was
# built from the same, it is not built again — a change to the server alone
# then costs the site only the server's own start, not the build as well.
BUILT_FROM="$ROOT/dist/.built-from"
SOURCES="$(
  for each in src public index.html vite.config.js package.json pnpm-lock.yaml; do
    git rev-parse "HEAD:$each" 2>/dev/null || echo "none:$each"
  done
  git status --porcelain -- src public index.html vite.config.js package.json pnpm-lock.yaml
  grep '^VITE_' "$ROOT/.env" 2>/dev/null || true
)"

if [ -f "$BUILT_FROM" ] && [ "$SOURCES" = "$(cat "$BUILT_FROM")" ] && [ -z "$(git status --porcelain -- src public index.html vite.config.js package.json pnpm-lock.yaml)" ]; then
  echo "Frontend unchanged; not building."
  "$ROOT/stop.sh"
  "$ROOT/start.sh"
  exit 0
fi

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
printf '%s\n' "$SOURCES" > "$BUILT_FROM"

"$ROOT/start.sh"

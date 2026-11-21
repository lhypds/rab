#!/bin/bash

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Stopping..."

# Read PM2_NAME from .env
PM2_NAME=$(grep '^PM2_NAME=' "$ROOT/.env" 2>/dev/null | cut -d= -f2 || echo rab)

pm2 stop "${PM2_NAME:-rab}" 2>/dev/null || echo "${PM2_NAME:-rab} was not running"

echo "Stopped."

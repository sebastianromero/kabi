#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

ASTRO_HOST="127.0.0.1"
ASTRO_PORT="4321"
ASTRO_URL="http://${ASTRO_HOST}:${ASTRO_PORT}"
STARTED_ASTRO="0"
ASTRO_LOG_FILE="/tmp/kabi-astro-dev-${ASTRO_PORT}.log"

cleanup() {
  if [ "$STARTED_ASTRO" = "1" ] && [ -n "${ASTRO_PID:-}" ] && kill -0 "$ASTRO_PID" >/dev/null 2>&1; then
    kill "$ASTRO_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if ! curl -fsS "$ASTRO_URL" >/dev/null 2>&1; then
  bun run web:dev --host "$ASTRO_HOST" --port "$ASTRO_PORT" >"$ASTRO_LOG_FILE" 2>&1 &
  ASTRO_PID=$!
  STARTED_ASTRO="1"
fi

for _ in $(seq 1 60); do
  if curl -fsS "$ASTRO_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! curl -fsS "$ASTRO_URL" >/dev/null 2>&1; then
  echo "Astro dev server did not start."
  echo "Last logs:"
  tail -n 60 "$ASTRO_LOG_FILE" || true
  exit 1
fi

KABI_DEV_SERVER_URL="$ASTRO_URL" electron-forge start

#!/usr/bin/env bash
# Start flight → guard proxy → UI in one terminal. Ctrl+C stops all.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FLIGHT_PORT="${FLIGHT_PORT:-8000}"
PROXY_PORT="${PROXY_PORT:-8787}"
UI_PORT="${UI_PORT:-5173}"

if [[ -f "$ROOT/scripts/dev.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/scripts/dev.env"
  set +a
fi

PIDS=()

cleanup() {
  echo ""
  echo "[dev] stopping…"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  make stop FLIGHT_PORT="$FLIGHT_PORT" PROXY_PORT="$PROXY_PORT" UI_PORT="$UI_PORT" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

echo "[dev] flight :$FLIGHT_PORT → proxy :$PROXY_PORT → ui :$UI_PORT"
echo "[dev] open http://localhost:$UI_PORT (Ctrl+C to stop all)"
if [[ ! -f "$ROOT/scripts/dev.env" ]]; then
  echo "[dev] tip: cp scripts/dev.env.example scripts/dev.env for Auth0 on flight+proxy"
fi
echo ""

uv run --directory servers/flight python server.py &
PIDS+=($!)
sleep 1

MCP_PROXY_PORT="$PROXY_PORT" npm run dev:proxy -w @mcp-tool-guard/gateway &
PIDS+=($!)
sleep 1

npm run dev -w ui &
PIDS+=($!)

wait

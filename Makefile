.PHONY: setup flight proxy ui keys stop

FLIGHT_PORT ?= 8000
PROXY_PORT ?= 8787

# One-time setup
setup:
	uv sync --directory servers/flight
	npm install
	npm run generate-keys

# Stop the flight server (SIGTERM; no-op if port is free)
stop:
	-@lsof -ti :$(FLIGHT_PORT) | xargs kill 2>/dev/null || true

# Daily dev — run each in its own terminal (flight → proxy → ui)
flight:
	uv run --directory servers/flight python server.py

proxy:
	MCP_PROXY_PORT=$(PROXY_PORT) npm run dev:proxy -w @mcp-tool-guard/gateway

ui:
	npm run dev -w ui

keys:
	npm run generate-keys

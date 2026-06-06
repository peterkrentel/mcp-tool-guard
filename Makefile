.PHONY: setup dev flight proxy ui keys stop

FLIGHT_PORT ?= 8000
PROXY_PORT ?= 8787
UI_PORT ?= 5173

# One-time setup
setup:
	uv sync --directory servers/flight
	npm install
	npm run generate-keys

# Stop dev servers (no-op if ports are free)
stop:
	-@lsof -ti :$(FLIGHT_PORT) | xargs kill 2>/dev/null || true
	-@lsof -ti :$(PROXY_PORT) | xargs kill 2>/dev/null || true
	-@lsof -ti :$(UI_PORT) | xargs kill 2>/dev/null || true

# Daily dev — one terminal (flight → proxy → ui)
dev:
	@chmod +x scripts/dev.sh
	@./scripts/dev.sh

# Or run each in its own terminal
flight:
	uv run --directory servers/flight python server.py

proxy:
	MCP_PROXY_PORT=$(PROXY_PORT) npm run dev:proxy -w @mcp-tool-guard/gateway

ui:
	npm run dev -w ui

keys:
	npm run generate-keys

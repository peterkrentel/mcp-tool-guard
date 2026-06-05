.PHONY: setup flight documents ui keys stop

FLIGHT_PORT ?= 8000
DOCUMENTS_PORT ?= 8001

# One-time setup
setup:
	uv sync --directory servers/flight
	uv sync --directory servers/documents
	npm install
	npm run generate-keys

# Stop demo MCP servers (SIGTERM; no-op if port is free)
stop:
	-@lsof -ti :$(FLIGHT_PORT) | xargs kill 2>/dev/null || true
	-@lsof -ti :$(DOCUMENTS_PORT) | xargs kill 2>/dev/null || true

# Daily dev — run each in its own terminal
flight:
	uv run --directory servers/flight python server.py

documents:
	uv run --directory servers/documents python server.py

ui:
	npm run dev -w ui

keys:
	npm run generate-keys

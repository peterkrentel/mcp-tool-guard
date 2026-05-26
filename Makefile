.PHONY: setup flight ui keys

# One-time setup
setup:
	uv sync --directory servers/flight
	npm install
	npm run generate-keys

# Daily dev — run each in its own terminal
flight:
	uv run --directory servers/flight python server.py

ui:
	npm run dev -w ui

keys:
	npm run generate-keys

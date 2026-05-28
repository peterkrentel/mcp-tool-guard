You’re on main at b01f60a (docs PR #7 merged). Up to date with origin/main.

0.2.0 — Vercel deployment (natural order)
Two Vercel projects (separate origins):

#	Project	Root / entry	You get
1
Flight MCP
servers/flight/ (vercel.json, api/index.py)
https://<flight>.vercel.app/mcp, /health, /audit
2
UI
ui/dist after npm run build -w ui
Static app; set VITE_MCP_URL=https://<flight>.vercel.app/mcp at build time
Flight env (Vercel):

MCP_GUARD_PUBLIC_KEY_PEM — paste PEM (or rely on committed ui/public/demo-public.pem only for local/CI; production should set env explicitly)
MCP_GUARD_ENABLED — leave on (default)
After deploy:

Task 5 — tighten CORS on flight to UI origin(s) (currently * in server.py)
Smoke: Initialize → search → cancel with read-only → see client + server audit
Task 7 — cut 0.2.0 in CHANGELOG when you’re happy
Already done on main: Bearer JWT, server guard, VITE_MCP_URL support, deploy notes in README.

Local prep when you’re ready: make setup → make flight + make ui to validate; then cd servers/flight && vercel first, then UI build with VITE_MCP_URL set.

Say when you want to start deploy (Agent mode can walk through Vercel + CORS + README checklist).

image.png
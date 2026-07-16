# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MCPToolGuard is a firewall for AI agent tool calls: it sits between an agent and any MCP server, enforcing JWT scope policy so a read-only token cannot invoke a write tool even if the agent tries. Every call is logged to an audit trail and traced via OpenTelemetry; sensitive ops can be held for human approval.

## Commands

```bash
make setup           # first time: uv sync (flight), npm install, generate demo JWT keys into keys/
make install-hooks    # installs pre-commit hook requiring staged CHANGELOG.md updates

make dev              # one terminal: flight :8000 -> proxy :8787 -> ui :5173
make flight           # just the flight MCP server (uv run --directory servers/flight python server.py)
make proxy            # just the guard proxy (npm run dev:proxy -w @mcp-tool-guard/gateway)
make ui               # just the UI (npm run dev -w ui)
make stop             # kill anything on 8000/8787/5173

npm run typecheck                # tsc --noEmit across gateway + workspaces (CI gate)
npm run test -w @mcp-tool-guard/gateway   # gateway tests (node --test tests/*.test.mjs)
node --test gateway/tests/proxy-auth.test.mjs   # single test file
npm run check:demo-policy        # asserts flight's embedded guard_config.yaml matches gateway/config.yaml
npm run build -w @mcp-tool-guard/ui       # build UI
npm run generate-keys            # regenerate demo JWT keypair (scripts/generate-keys.mjs)
```

Only the `gateway` workspace has a test suite (Node's built-in test runner, `.test.mjs` files in `gateway/tests/`) — there is no UI or Python test suite currently.

After changing `servers/flight/pyproject.toml`, regenerate the lockfile Vercel deploys from:
```bash
uv export --directory servers/flight --no-hashes -o servers/flight/requirements.txt
```

## Architecture

Three services, npm workspaces (`gateway`, `ui`) + a standalone Python server (`servers/flight`):

- **`gateway/`** — the `ToolGuard` SDK (TypeScript). Two roles in one package:
  - Client-side (`guard.ts`): JWT verify + scope check used by browser agents as a pre-check.
  - `proxy-server.ts`: the **authoritative** enforcement point. It's a composition root that delegates to `proxy-routes-*.ts` modules (`-mcp`, `-agents-token`, `-audit`, `-servers`, `-pending`, `-llm`) rather than being a monolith — look there first when adding an HTTP route.
- **`ui/`** — Vite + WebLLM demo frontend. Two distinct agent paths live here (see below).
- **`servers/flight/`** — a Python (FastMCP) MCP server with its own embedded copy of the guard (`guard.py`, `guard_middleware.py`) for demo purposes only.

### Two agent paths in the UI

- **FlightAgent** (`ui/src/agent.ts`, demo `/`) — heuristics + in-browser WebLLM, talks to the flight MCP server through the client `ToolGuard`.
- **GatewayAgent** (`ui/src/gateway-agent.ts`, `/agents.html`) — M2M agent provisioning: creates an Auth0 M2M client (`POST /agents` -> `gateway/proxy-routes-agents-token.ts` -> `gateway/auth0-mgmt.ts`), vends a JWT (`gateway/token-vendor.ts`), then drives Gemini/Groq/Mistral via `gateway/llm-proxy.ts`. Supports registering arbitrary vendor MCPs (e.g. GitHub, Slack) at runtime via `/servers`.

### Policy is single-sourced, enforcement is layered

`gateway/config.yaml` is canonical. `servers/flight/guard_config.yaml` is a **demo-only** duplicate that CI (`npm run check:demo-policy`) keeps aligned — if you change scopes/tools in one, update the other or CI fails.

Only two layers are authoritative for security: the guard proxy (`gateway/proxy-server.ts`) and the flight server's embedded middleware. Everything else — the client `ToolGuard` pre-check and the UI's agent-trace panel — is a pre-check/observability layer only, not enforcement. Keep this distinction in mind when reasoning about "is this actually blocked": a client-side deny never reaches the MCP server and produces no server audit row, whereas a proxy/server deny is the real enforcement event.

Correspondingly there are three observability planes surfaced in the UI, correlated by a single `trace_id` per user turn: **Agent trace** (routing/LLM debug), **Agent attempts** (client pre-check log), **Proxy / server enforcement** (`GET /audit`, authoritative). Full diagrams: `docs/ARCHITECTURE.md`.

### Deployment topology

Three independently deployed services: UI on Vercel, guard proxy on Render (not Vercel — it needs a long-lived process for rate limiting/audit state), flight MCP on Vercel. Local dev proxies `/mcp` and `/audit` through Vite (`ui/vite.config.ts`) to the local guard proxy; prod UI talks to the Render proxy via `VITE_MCP_URL`. See `docs/deploy-overview.md` before touching deploy config.

## Workflow rules (enforced, not optional)

- **Never commit or push to `main` directly.** Every change — including docs and CHANGELOG-only edits — goes through a feature branch + PR (`feature/`, `fix/`, `docs/`, `release/<version>`). When finishing work: push the branch and give the user the compare URL (`https://github.com/peterkrentel/mcp-tool-guard/compare/main...<branch>`) plus a suggested title/body; do not merge yourself.
- **Use `git` only — never run `gh`** (no PR/issue/release creation via GitHub CLI or API).
- **Every PR must update `CHANGELOG.md` under `[Unreleased]`** — CI enforces this at both PR and per-commit level (Dependabot exempt). The local pre-commit hook from `make install-hooks` checks this too.
- Releases are CHANGELOG + optional annotated git tag only — never create a GitHub Release via UI, `gh release create`, or the releases API.
- Active/deferred work is tracked centrally in `backlog.md` (the canonical backlog) — check there rather than assuming ROADMAP.md alone is current.

## Demo secrets note

`ui/public/demo-tokens.json` and `demo-public.pem` are intentionally public pre-signed guest tokens for the flight demo — not production secrets. Real deployments use Auth0 JWKS or a private PEM via env vars (private key lives in `keys/`, gitignored).

# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Bump `typescript` from 5.9.x to 6.0.3 in `ui` and `gateway` (with Vite 8 on `ui`)

### Added

- Server-side JWT scope enforcement on flight MCP (`guard.py`, `guard_middleware.py`, `guard_config.yaml`)
- `Authorization: Bearer` on MCP HTTP client; `VITE_MCP_URL` for remote flight deploy
- Flight `GET /audit` for recent server-side allow/deny entries (in-memory)
- Audit UI: server (authoritative) + client (pre-check) sections; `/audit` Vite proxy for local dev
- `session_id` and `trace_id` on audit entries — correlate client pre-check with server enforcement
- `make stop` to gracefully stop the flight server on port 8000

### Fixed

- ASGI middleware SSE fix: forward `receive()` after body replay (fixes Initialize failures)
- Agent pending-state loop when LLM picked wrong tool; help text and book-by-route heuristics
- CI workflow (`ci.yml`): typecheck, npm build, and flight server import check on PRs to `main`
- Changelog workflow: exempt Dependabot PRs from required `CHANGELOG.md` diff
- Documentation: [ROADMAP.md](docs/ROADMAP.md), [RELEASE.md](docs/RELEASE.md), [CONTRIBUTING.md](CONTRIBUTING.md)
- PR template and CI check requiring CHANGELOG updates on pull requests to `main`
- Cursor rule for branch + PR + changelog workflow
- Condensed [CONCEPT.md](docs/CONCEPT.md) with current limitations and remote deployment notes

### Planned (target: [0.2.0](docs/RELEASE.md#020-remote--server-auth))

- Deploy flight MCP and UI to Vercel (or equivalent hosting)
- Tighten CORS to UI origin(s)
- Central audit persistence (DB / log sink)

---

## [0.1.0] - 2025-05-25

### Added

- Flight MCP server (FastMCP, mock data, HTTP `/mcp`, Vercel entrypoint)
- Browser UI with WebLLM agent loop and audit dashboard
- TypeScript `ToolGuard` (JWT verify, per-tool scopes from `gateway/config.yaml`)
- Demo RSA keys and JWT profiles (`read_only`, `booking`, `admin`)
- Makefile: `setup`, `flight`, `ui`, `keys`
- Docs: README quick start, CONCEPT (JWT reference)

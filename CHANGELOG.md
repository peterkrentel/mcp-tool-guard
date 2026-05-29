# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Docs: reorder 0.3 priorities; demo tokens transitional until Auth0 ([NEXT-STEPS](docs/NEXT-STEPS.md), [ROADMAP](docs/ROADMAP.md))
- **0.3 pivot:** [identity.md](docs/identity.md) — Auth0 IdP (Path A) vs audit secret (Path B, not pursuing)
- [auth0-setup.md](docs/auth0-setup.md) + [auth0-env.example](docs/auth0-env.example) — Auth0 prep before implementation
- CONCEPT: [Third-party / unowned MCP](docs/CONCEPT.md#third-party--unowned-mcp), [Identity & IdP](docs/CONCEPT.md#identity--idp)

### Planned (0.3.0)

See [ROADMAP](docs/ROADMAP.md#release-030--hardening--multi-server), [NEXT-STEPS](docs/NEXT-STEPS.md), [auth0-setup.md](docs/auth0-setup.md).

**First PRs:** Auth0 login + JWKS + `iss`/`aud` + `/audit` Bearer JWT + guard warning + UI audit errors.

- Auth0 SPA login **+ guest demo** (existing `demo-tokens.json`); dual PEM + JWKS on flight
- JWKS + `iss` / `aud` on flight + SDK (PEM fallback for CI)
- `GET /audit` requires same access token
- `MCP_GUARD_ENABLED` fail-closed or loud warning
- UI server audit fetch error state
- Vercel KV — after identity PR
- Multi-server client; guard proxy (Tier 2)

---

## [0.2.0] - 2026-05-25

### Added

- [docs/vercel-deploy.md](docs/vercel-deploy.md) — Vercel deploy guide (verified settings, troubleshooting, live demo URLs)
- [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md) — post–0.2.0 priorities and 0.3.0 backlog
- Live demo: [UI](https://mcp-tool-guard-ui.vercel.app/), [flight health](https://mcp-tool-guard-flight-server.vercel.app/health)
- Server-side JWT scope enforcement on flight MCP (`guard.py`, `guard_middleware.py`, `guard_config.yaml`)
- `Authorization: Bearer` on MCP HTTP client; `VITE_MCP_URL` for remote flight deploy
- Flight `GET /audit` for recent server-side allow/deny entries (in-memory)
- Audit UI: **Server enforcement** (authoritative) + **Agent attempts** (SDK observability); `/audit` Vite proxy for local dev
- `session_id` and `trace_id` on audit entries — correlate agent attempts with server enforcement
- `make stop` to gracefully stop the flight server on port 8000

### Changed

- CORS on flight server: default allow UI + local Vite origins; override via `MCP_CORS_ORIGINS` (see [vercel-deploy.md](docs/vercel-deploy.md))
- CONCEPT: observability scope (metrics/traces/logs framing vs tool-gate focus; in/out of scope for 0.x)
- Docs: README live demo + [vercel-deploy.md](docs/vercel-deploy.md); ROADMAP 0.2.0 complete, [0.3.0 hardening](docs/ROADMAP.md#release-030--hardening--multi-server)
- Bump `typescript` from 5.9.x to 6.0.3 in `ui` and `gateway` (with Vite 8 on `ui`)
- Document demo vs production shape in ROADMAP and CONCEPT (dual audit UI; Grafana/Loki for prod server logs)
- Dual audit framing in UI/docs: server = security decisions, agent attempts = intent (not compliance evidence)
- CI workflow (`ci.yml`): typecheck, npm build, and flight server import check on PRs to `main`
- Changelog workflow: exempt Dependabot PRs from required `CHANGELOG.md` diff
- Documentation: [ROADMAP.md](docs/ROADMAP.md), [RELEASE.md](docs/RELEASE.md), [CONTRIBUTING.md](CONTRIBUTING.md)
- PR template and CI check requiring CHANGELOG updates on pull requests to `main`
- Cursor rule for branch + PR + changelog workflow
- Condensed [CONCEPT.md](docs/CONCEPT.md) with current limitations and remote deployment notes
- Root / workspace package version → `0.2.0`

### Fixed

- Flight `vercel.json`: remove `functions` block (caused instant “unmatched function pattern” before Python build)
- CI typecheck: build `gateway` before `ui` typecheck (`dist/` is gitignored; types live in `gateway/dist`)
- CI flight job: commit `ui/public/demo-public.pem` (was ignored by `*.pem`; required for server import)
- ASGI middleware SSE fix: forward `receive()` after body replay (fixes Initialize failures)
- Agent pending-state loop when LLM picked wrong tool; help text and book-by-route heuristics

---

## [0.1.0] - 2025-05-25

### Added

- Flight MCP server (FastMCP, mock data, HTTP `/mcp`, Vercel entrypoint)
- Browser UI with WebLLM agent loop and audit dashboard
- TypeScript `ToolGuard` (JWT verify, per-tool scopes from `gateway/config.yaml`)
- Demo RSA keys and JWT profiles (`read_only`, `booking`, `admin`)
- Makefile: `setup`, `flight`, `ui`, `keys`
- Docs: README quick start, CONCEPT (JWT reference)

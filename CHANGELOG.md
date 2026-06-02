# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- UI client guard loads policy from `gateway/config.yaml` (Vite yaml import); `npm run check:demo-policy` keeps demo flight `guard_config.yaml` aligned until guard proxy (#12)

### Changed

- Release process: CHANGELOG + optional git tag only — no GitHub Releases UI ([RELEASE.md](docs/RELEASE.md), [CONTRIBUTING.md](CONTRIBUTING.md))
- Workflow: always branch + PR to `main` — no direct pushes ([CONTRIBUTING.md](CONTRIBUTING.md), `.cursor/rules/release-and-pr-workflow.mdc`)
- ROADMAP #8 done: canonical policy in `gateway/config.yaml`; `servers/flight/guard_config.yaml` documented as demo-only embedded guard ([CONCEPT.md](docs/CONCEPT.md))

## [0.3.1] - 2026-06-02

### Added

- WebLLM heuristics: `FL 505` → `FL505`, `search all flights` / bare `search`, intercept invented booking JSON ([ROADMAP #11](docs/ROADMAP.md))
- Read-only Auth0 demo screenshots: jwt.io `flights:read` token and prod UI scope deny ([docs/images/demo/](docs/images/demo/README.md))

### Changed

- Stronger agent system prompt — never emit raw flight/booking JSON; only tool JSON or plain text
- Planning docs: mark ROADMAP #11 done; suggest #8 policy drift next (`immediate-nest-step`, `NEXT-STEPS`, `ROADMAP`)

## [0.3.0] - 2026-06-02

### Added

- Auth0 SPA login in demo UI (`@auth0/auth0-spa-js`) with **guest demo** fallback (`demo-tokens.json` dropdown)
- Dual JWT trust on flight server and SDK: **JWKS + `iss`/`aud`** (Auth0) or **demo PEM** (guest)
- `GET /audit` requires valid `Authorization: Bearer` when guard is enabled
- UI audit panel: visible error when server audit fetch fails (401, network, etc.)
- Flight health: `jwt_trust_enabled`, `kv_enabled` (when `KV_REST_API_*` set)
- Vercel KV (Upstash REST) for durable **server audit** and **bookings** on serverless; in-memory fallback locally ([kv-design.md](docs/kv-design.md))
- README Live demo screenshots (prod UI + Auth0 access token on jwt.io)
- [docs/kv-design.md](docs/kv-design.md), [docs/images/demo/](docs/images/demo/README.md)

### Fixed

- Auth0 RBAC: read `permissions` claim in flight guard and SDK `ToolGuard` (alongside `scope` / `scp`)

### Changed

- `ToolGuard` accepts optional `jwtIssuer`, `jwtAudience`, `jwksUrl` for IdP tokens
- Env vars: `VITE_AUTH0_*`, `MCP_JWT_*`, `VITE_ENABLE_GUEST_DEMO`, `KV_REST_API_*` — see [auth0-env.example](docs/auth0-env.example), [vercel-deploy.md](docs/vercel-deploy.md#vercel-kv-phase-b)
- Docs: [auth0-setup.md](docs/auth0-setup.md) (local testing learnings), [identity.md](docs/identity.md), [NEXT-STEPS](docs/NEXT-STEPS.md), [vercel-deploy.md](docs/vercel-deploy.md), [README](README.md)
- Project rule: git-only workflow (no `gh` CLI); [CONTRIBUTING.md](CONTRIBUTING.md) updated

### Security

- Loud startup warning when `MCP_GUARD_ENABLED=false` (enforcement bypassed)

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

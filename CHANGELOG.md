# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Demo deck refresh: updated `docs/overview.pptx` for the latest product walkthrough
- **OpenTelemetry (guard proxy)** — optional OTLP HTTP export via `gateway/telemetry.ts`; manual spans for proxy `tools/call` decisions (allow/deny/pending), `POST /audit/agent`, MCP upstream forward, Gemini LLM; gated on `OTEL_EXPORTER_OTLP_ENDPOINT`; [otel.md](docs/otel.md)

### Changed

- **Docs: client-readiness accuracy pass** — `MCP_APPROVAL_QUEUE=true` callout added to CONCEPT.md (limitations table) and README.md (quick start); `POST /llm/complete` route added to guard-proxy.md; ARCHITECTURE.md gains rate limiter, `POST /audit/agent`, `POST /llm/complete`, and `POST /token` in component map; demo-proxy.md Demo 8 gains prod runtime-registration callout for Slack.

### Changed

- **Workflow hardening (changelog policy)** — enforce changelog updates on every non-Dependabot commit in PR CI, add local pre-commit hook install path (`make install-hooks`) and CONTRIBUTING guidance so changelog compliance is proactive instead of last-minute.
- **Demo deck follow-up (PR #115)** — refined `docs/overview.pptx` content/flow for the current proxy enforcement walkthrough.
- **Changelog compliance (docs/post-otel-doc-cleanup)** — add required `Unreleased` entry to satisfy PR changelog check for non-Dependabot contributions.
- **Docs accuracy pass (0.4 follow-up)** — fix `GET /audit` response shape (`sources` array, not `.source` / `guard-proxy`); ARCHITECTURE agent route `:clientId`, `agents-main.ts` line ~441; render-deploy GitHub live vs runtime Slack; CONCEPT authoritative audit on proxy; demo-proxy Demo 5 + gateway-agent anchor
- **Docs: ARCHITECTURE.md comprehensive refresh** — Added GatewayAgent flow (`agents-main.ts` → `proxy-api.ts` → `token-vendor.ts` → `gateway-agent.ts`); expanded component map with agent provisioning; updated system context diagram to show both FlightAgent and GatewayAgent paths; clarified "Today vs next" table with separate rows for FlightAgent (demo) vs GatewayAgent (M2M) with approval queue support
- **Docs cleanup + backlog canonicalization** — removed stray raw notes from `docs/demo-proxy.md`; updated `docs/otel.md` to shipped status with acceptance checklist complete; added `GEMINI_API_KEY` and distributed rate-limit notes in `docs/guard-proxy.md`; refreshed `docs/ARCHITECTURE.md` shipped-state rows; added root `backlog.md` as canonical open-work tracker and cross-linked from README/ROADMAP/NEXT-STEPS

### Fixed

- **OpenTelemetry 0.219.0 API migration** — Updated `gateway/telemetry.ts` for OTel SDK breaking changes: `new Resource()` → `resourceFromAttributes()` (resources v2.8.0), LoggerProvider `addLogRecordProcessor()` → inline `processors` array (sdk-logs 0.219.0)
- **Changelog policy (CI workflow)** — Exempt Copilot from per-commit CHANGELOG requirement to allow IDE-assisted fixes on Dependabot PRs without blocking
- **Starlette CVE-2026-54282** — Regenerated `servers/flight/uv.lock` to pin Starlette ≥1.3.1 (unvalidated request path handling in authority)
- **ARCHITECTURE.md endpoint reference** — Corrected `POST /agents` endpoint location: `gateway/proxy-api.ts` (non-existent) → `gateway/proxy-server.ts` (actual location)

### Removed

## [0.4.0] - 2026-06-22

### Added

- **Runtime vendor MCP registration** — `POST /servers` accepts optional `upstream_token_env` field; proxy resolves token from env at registration time; KV persistence carries `upstream_token_env` across restarts; GUI "External MCPs" form gains optional upstream token env var field; `proxy-api.ts` `addServer` updated to forward the field
- **Proxy stream header fix** — `gateway/mcp-upstream.ts` strips `content-length` and `content-encoding` from upstream streaming responses to prevent downstream parse errors (e.g. Vite dev proxy `ERR_STREAM_WRITE_AFTER_END`)
- **Docs accuracy pass** — remove stale Slack stub references; `config.yaml`/`config.prod.yaml` Slack blocks removed (runtime-registered instead); deploy/arch docs updated to reflect runtime vendor MCP model; `NEXT-STEPS.md` adds GUI-managed upstream secrets as future item

- **Tier-2 hardening** — `gateway/llm-proxy.ts`: `POST /llm/complete` proxies Gemini server-side (`GEMINI_API_KEY` on Render, never in browser bundle); `GeminiRunner` calls proxy instead of Google directly; `gemini_configured` on `/health`; KV audit persistence (`gateway:audit:recent`, ring buffer 500, loaded at startup); distributed rate limiting (`kvRateLimitExceeded` fixed-window KV counter per IP per minute, complements in-memory sliding window); `kvSet` gains optional `ttlSec`; `examples/python-agent/agent.py` stdlib-only backend agent with approval retry loop
- **Track 3 — Approval queue (end-to-end)** — `gateway/pending-store.ts`, `MCP_APPROVAL_QUEUE=true` gate, `202` pending response, admin `/pending/*` resolve routes, time-bound approval tokens bound to tool+server, `x-approval-token` bypass path, Gemini native function-calling, agent polls `/pending/:id` and retries with token; audit decision type includes `"pending"`
- **Track 3 prod proof** — [track3-approval-queue-proof.md](docs/track3-approval-queue-proof.md): `repo:read` agent → approval queue → admin approves → one-time token → retry → GitHub file created; Render logs + commit link
- **Track 2 prod proof** — [track2-github-proof.md](docs/track2-github-proof.md): GitHub MCP curl allow + **proxy write deny** (`repo:read`-only agent → `-32001` on `create_or_update_file`), Render logs, screenshots; [demo-proxy Demo 6](docs/demo-proxy.md#demo-6--github-mcp-external-upstream) updated
- **GitHub MCP (Track 2)** — `upstream_token_env` on server config; proxy substitutes `GITHUB_MCP_TOKEN` for upstream auth while enforcing caller JWT scopes (`repo:read` / `repo:write`); `upstream_auth_missing` on `/health`; [demo-proxy Demo 6](docs/demo-proxy.md#demo-6--github-mcp-external-upstream)
- **Gateway KV persistence (Track 1)** — `gateway/kv.ts` Upstash REST client; runtime MCP registry + agent records survive proxy restart; `GET /agents`; `kv_enabled` on `/health`; `/agents.html` loads agents from server (secrets in sessionStorage only)

### Changed

- **Post–Track 2 docs hygiene** — ROADMAP, ARCHITECTURE, deploy-overview, render-deploy, CONCEPT, identity, auth0-setup (`repo:read`/`repo:write`), cursor-guide, NEXT-STEPS limitations, README gateway-first pivot, vercel-deploy, `immediate-nest-step.md`
- **Docs + proxy hardening follow-up** — documented demo trust caveats for `POST /audit/agent` and `GET /pending/:id`; updated Demo 7 GitHub example to base64-encode file content; moved Gemini upstream auth from URL query to `x-goog-api-key` header and aligned env docs to server-side `GEMINI_API_KEY` usage.

### Fixed

- **Approval queue — pending poll auth** — `GET /pending/:id` no longer requires `gateway:admin`; agents can poll their own pending ID without an admin token; `localeCompare` crash on stale KV entries missing `requested_at` field guarded with `?? ""`
- **Approval queue — scope bypass** — `approvedViaToken` flag prevents final 403 after valid approval token; polling GETs (`/audit`, `/pending/*`) exempted from rate limiter; agent retry loop breaks on tool error instead of looping; dropdown `<select>` no longer reset mid-interaction by background poll
- **Gateway KV scan** — fix Upstash REST SCAN URL and string cursor `"0"` termination (was hanging Render startup when `KV_REST_API_*` set)
- **Agent re-vend** — encrypt M2M `clientSecret` at create (AES-GCM, key from `GATEWAY_AGENT_SECRET_KEY` or `AUTH0_MGMT_CLIENT_SECRET`); `POST /agents/:clientId/token` vends JWT so persisted agents are usable after refresh/new browser
- **Cursor implementation guide** — [cursor-guide.md](docs/cursor-guide.md): three sequential tracks (KV registry → GitHub MCP → approval queue); cross-links [kv-design](docs/kv-design.md) and [CONCEPT → unowned MCP](docs/CONCEPT.md#third-party--unowned-mcp); approval queue KV keys sketched in kv-design
- Docs: align [NEXT-STEPS](docs/NEXT-STEPS.md), [ROADMAP](docs/ROADMAP.md), [demo-proxy](docs/demo-proxy.md) with three-track build order; flight `/` as canonical audit demo surface
- **Agent gateway admin auth** — `gateway:admin` on control plane (`POST/DELETE /servers`, `/agents`, `POST /token`) when guard + IdP trust enabled; `/agents.html` operator sign-in; `GET /health` reports `control_plane_auth`
- Docs: product differentiators + build filter ([ROADMAP](docs/ROADMAP.md#build-filter)), proof vs presentation ([CONCEPT](docs/CONCEPT.md#proof-vs-presentation)), canonical demo guidance ([demo-proxy.md](docs/demo-proxy.md))
- Structured upstream errors — proxy returns `{ error: "upstream_unavailable", server, detail }` on MCP connect/discovery failures; `tools/call` JSON-RPC error when upstream is unreachable
- Flight guard middleware — 1 MiB max request body before JSON parse (DoS hardening)

- **Agent gateway (stage 1, in-memory)** — dynamic MCP registry (`GET/POST/DELETE /servers`), tool discovery (`GET /servers/:id/tools`), Auth0 M2M agent lifecycle (`POST/DELETE /agents`), token vending (`POST /token`), three-layer audit (`agent` / `proxy` / `mcp` sources, `POST /audit/agent`), sliding-window rate limit (60 req/min per IP)
- **`/agents` UI** — register external MCPs, create/revoke M2M agents, LLM selector (WebLLM, Gemini, Groq, Mistral), three-layer audit panel with trace correlation
- [.env.example](.env.example) — `AUTH0_*` mgmt + audience vars for agent gateway
- [docs/render-deploy.md](docs/render-deploy.md) — step-by-step Render deploy guide for guard proxy (env vars, build/start, smoke tests, UI rewire, `Accept` header for curl, troubleshooting)
- [docs/demo-proxy.md](docs/demo-proxy.md) — live demo script: Network tab, read-only deny, Render logs, curl proxy deny, code review path
- [docs/deploy-overview.md](docs/deploy-overview.md) — single deploy map: local proxy path, prod three-service layout (UI + Render proxy + flight)
- `gateway/config.prod.yaml` — prod policy config with Vercel flight URL; set `MCP_PROXY_CONFIG=config.prod.yaml` on Render
- `make dev` — one command starts flight → guard proxy → UI; `scripts/dev.env` for shared `MCP_JWT_*`; `make stop` frees :8000/:8787/:5173
- **Guard HTTP proxy** (#12) — `gateway/proxy-server.ts`: JWT scope enforcement on `tools/call`, forward to upstream MCP from `gateway/config.yaml`, `GET /audit` + `GET /health`; `make proxy` ([guard-proxy.md](docs/guard-proxy.md))
- Vite dev proxies `/mcp` and `/audit` to guard proxy (:8787) instead of flight directly
- Docs: scopes vs roles — IdP grants scope rights (optionally via roles); guard enforces per tool ([CONCEPT](docs/CONCEPT.md#scopes-roles-and-identity), [identity](docs/identity.md#scopes-vs-roles-how-admins-grant-access), [auth0-setup](docs/auth0-setup.md))
- **Agent trace** panel in audit sidebar — per-turn routing (heuristic / LLM / pending), model preview, `trace_id` highlight across server + client rows
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system diagrams (mermaid), three observability planes, policy, today vs guard proxy
- UI client guard loads policy from `gateway/config.yaml` (Vite yaml import); `npm run check:demo-policy` keeps demo flight `guard_config.yaml` aligned until guard proxy (#12)

### Fixed

- Guard proxy audit stdout — single-line `console.log` per allow/deny so Render and PaaS log viewers show `[MCPToolGuard]` request lines (multi-arg `console.info` was dropped by some hosts)
- Vite dev proxy `/agents` no longer intercepts `/agents.html` (including `?query` URLs); agent forms use `method="post"` to avoid GET navigation
- Agents page lazy-loads `gateway-agent` on Initialize so Add MCP / Create agent work without loading `mcp-client` at page load
- Vite proxy regex for `/:serverId/mcp` anchored with `$` so `/src/mcp-client.ts` is not forwarded to guard proxy
- `GatewayAgent` reuses the same LLM runner after Initialize (fixes WebLLM “not initialized” on Send)
- Agents page passes Auth0 JWKS trust (`jwtTrustFromAuth0`) so M2M tokens verify in the browser guard
- Guard proxy listens on `PORT` when `MCP_PROXY_PORT` is unset (Render injects `PORT`; local dev uses `MCP_PROXY_PORT` / `make dev`)

### Changed

- Root `package.json` — `engines.node` `>=22` (matches CI)
- Docs: Render deploy + demo-proxy cross-links in README, CONTRIBUTING, guard-proxy, NEXT-STEPS, deploy-overview, vercel-deploy, ARCHITECTURE, ROADMAP, CONCEPT
- Docs: prod architecture updated — guard proxy **deployed on Render**; next step is external MCP wiring
- Docs: **deploy-overview** — prod today is UI → Render proxy → Vercel flight (not UI → flight direct)
- Docs: defer **#9/#10** multi-server mock MCP; **#12** guard proxy is primary product path ([NEXT-STEPS](docs/NEXT-STEPS.md#implementation-backlog-post-030))
- Docs: agent gateway prod env — `AUTH0_MGMT_*` on Render, `VITE_PROXY_BASE_URL` on Vercel; routes in [guard-proxy.md](docs/guard-proxy.md); smoke tests in [render-deploy.md](docs/render-deploy.md), [vercel-deploy.md](docs/vercel-deploy.md)
- Docs: agent gateway admin auth sketch — `gateway:admin` control plane vs M2M runtime tokens ([NEXT-STEPS](docs/NEXT-STEPS.md#agent-gateway-admin-auth-sketch), [identity.md](docs/identity.md#admin-vs-agent-tokens-agent-gateway))
- Docs: agent registry + Auth0 sync backlog — KV source of truth, unique `mcp-agent-*` names, reuse/templates, `GET /agents` ([NEXT-STEPS](docs/NEXT-STEPS.md#agent-registry-auth0-sync-sketch), [kv-design.md](docs/kv-design.md#guard-proxy-kv-agent-gateway))
- Release process: CHANGELOG + optional git tag only — no GitHub Releases UI ([RELEASE.md](docs/RELEASE.md), [CONTRIBUTING.md](CONTRIBUTING.md))
- Workflow: always branch + PR to `main` — no direct pushes ([CONTRIBUTING.md](CONTRIBUTING.md), `.cursor/rules/release-and-pr-workflow.mdc`)
- ROADMAP #8 done: canonical policy in `gateway/config.yaml`; `servers/flight/guard_config.yaml` documented as demo-only embedded guard ([CONCEPT.md](docs/CONCEPT.md))

### Removed

- [docs/railway-deploy.md](docs/railway-deploy.md) and `railway.toml` — replaced by Render deploy guide (proxy live on Render free tier)

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

# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **`IdpAdapter` interface extraction + Auth0 implementation (BL-020)** — `gateway/proxy-routes-agents-token.ts` now consumes agent create/delete/token-vend via an injected `IdpAdapter` interface (`gateway/idp-adapter.ts`) instead of calling `gateway/auth0-mgmt.ts`/`gateway/token-vendor.ts` directly; `Auth0IdpAdapter` wraps that existing code unchanged so behavior (status codes, error messages) is preserved exactly. New `MCP_IDP_PROVIDER=auth0|keycloak|entra` env var (default `auth0`) selects the single active provider at startup per the BL-034 design spec, failing loudly on an unrecognized or not-yet-implemented value. `/health` now reports `idp_provider`, `idp_management_configured`, and `idp_vending_configured` instead of `jwt_trust_enabled`/`auth0_mgmt_configured`. `IdpAdapter`, `IdpProviderId`, `CreatedAgentClient`, `VendedToken`, `Auth0IdpAdapter`, and `buildIdpAdapter` are exported from `gateway/index.ts` for future Keycloak (BL-041) and Entra (BL-021) implementations.
- **Deployed-proxy smoke validator** — `scripts/smoke-deployed.sh` verifies JWT scope enforcement end-to-end against the real deployed Render guard proxy: reuses existing read-only GitHub/Slack M2M agents (never creates new ones), proves read-allow + write-deny (never completing the write, even if it lands in the approval queue), and checks the `/audit` three-source correlation. Authenticates as a standing `gateway:admin` Auth0 test user via `scripts/auth0-headless-login.mjs` (a small Playwright script that drives the real `/agents.html` login form and reads the resulting token out of localStorage) — the account's Auth0 client only supports the Authorization Code flow, and realm-based ROPG was tried and consistently rejected across several client configurations, so this replays the actual login instead of a non-interactive grant. Added `playwright` as a root devDependency and a matching `.claude/agents/smoke-deployed.md` subagent. New required local env vars documented in `scripts/dev.env.example`: `SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD`.
- **`JwtValidator` interface extraction (BL-019)** — `ToolGuard` (`gateway/guard.ts`) now consumes JWT validation via an injected `JwtValidator` interface instead of implementing PEM/JWKS dual-trust verification internally; existing behavior (issuer-matched JWKS verification with M2M-agent liveness checks, PEM fallback, scope extraction/matching) is preserved in a new `DefaultJwtValidator` built automatically from the same constructor options. `JwtValidator`, `JwtValidatorOptions`, and `DefaultJwtValidator` are now exported from `gateway/index.ts` so future IdP-specific validators (Keycloak per BL-041, Entra per BL-021) can implement the interface from outside the package. `gateway/admin-auth.ts` and `gateway/proxy-routes-audit.ts` updated to call `guard.jwtValidator.validateToken`/`.hasScope` instead of the removed direct `ToolGuard` methods.
- **`CLAUDE.md` and project subagents** — added root `CLAUDE.md` for Claude Code guidance (commands, architecture, enforcement-layer distinctions, workflow rules); added `.claude/agents/jwt-scope-reviewer.md` (read-only reviewer for JWT scope validation patterns in TypeScript) and `.claude/agents/jwt-validator-extractor.md` (scoped implementer for BL-019, explicitly barred from IdP adapter code)
- **Ephemeral k3d CI deployment lane (additive)** — added isolated assets for running UI + guard in Kubernetes with self-hosted Redis and an in-cluster KV REST bridge compatible with existing `KV_REST_API_URL` usage: new Dockerfiles (`gateway/Dockerfile`, `ui/Dockerfile`), Helm chart under `deploy/ephemeral/helm/guard-ephemeral`, Auth0 smoke script (`scripts/smoke-auth0-k3d.sh`), dedicated workflow (`.github/workflows/k3d-ephemeral-auth0.yml`), and setup guide (`docs/ephemeral-k3d-ci.md`)
- **BL-034 design spec: single-active-IdP trust model** — added `docs/superpowers/specs/2026-07-18-idp-trust-model-design.md`, deciding that a deployment trusts exactly one active IdP (selected via a new `MCP_IDP_PROVIDER=auth0|keycloak|entra` env var driving both `JwtValidator` and `IdpAdapter` construction) rather than the originally-scoped concurrent multi-issuer trust; rejects concurrent-IdP support and per-server/tool issuer restriction as out of scope. Design only — no code changes; BL-020/BL-021/BL-041 implement against this decision.
- **BL-020 implementation plan** — added `docs/superpowers/plans/2026-07-18-bl-020-idp-adapter.md`, a step-by-step TDD plan for extracting an `IdpAdapter` interface (analogous to BL-019's `JwtValidator`) and wiring `MCP_IDP_PROVIDER` selection per the BL-034 spec. Plan only — implementation lands in subsequent commits on this branch.
- **BL-037 design spec: Claude Code guard integration** — added `docs/superpowers/specs/2026-07-19-claude-code-guard-integration-design.md`, deciding to smoke-test Claude Code against the locally-registered `github` server (not `flight`, which runs its own embedded guard and wouldn't demonstrate the proxy as sole enforcement point) via a new `scripts/claude-mcp-token-helper.sh` `headersHelper` script, and to document (not assume) the read-allow/write-deny/write-pending behaviors plus a real observability gap: Claude Code's tool calls have no per-call `trace_id`/`session_id` and never produce `source: "agent"` audit entries, since those are conventions of this project's own browser SDK that Claude Code has no knowledge of. Design only — no gateway code changes; this is a docs-plus-smoke-test task using entirely existing infrastructure.

### Changed

- **Backlog: BL-024 marked done** — removed the completed `BL-024` (Dockerfiles + k3d ephemeral CI workflow, already shipped as `.github/workflows/k3d-ephemeral-auth0.yml` plus numerous follow-up hardening entries in this same changelog) entry from `backlog.md`'s open P0 list per the file's own completed-item rule; dropped the now-satisfied `BL-024` dependency from `BL-040` so it shows as unblocked
- **Backlog: added BL-044** — new P1 item: `PendingRequest` records (approval-queue bookkeeping) have no TTL or delete path, so `GET /pending` and the `/agents.html` approval queue panel grow unbounded over time. Plans auto-expiry for resolved records (TTL, matching the existing pattern for approval/poll tokens) plus a manual `DELETE /pending/:id` and GUI clear control; the permanent audit trail is unaffected either way.
- **Backlog: added BL-043** — new P1 item: re-approving an already-approved pending request (`POST /pending/:id/approve`) mints a second, independently-valid approval token instead of no-oping or rejecting; each token is still correctly single-use (confirmed in `gateway/pending-store.ts`'s `validateApprovalToken`, no token replay), but the approval-generation side has no idempotency guard against repeated approval of the same pending id. Discovered live on the deployed proxy during BL-020 smoke-test follow-up (two "allow ... Pending request approved" audit entries for one pending id, traced to the same request having been approved twice via the GUI).
- **Backlog: added BL-042** — new P1 item to document the control-plane auth trust model explicitly and decide whether `GET /agents` and the vending-config-check-before-admin-auth-check ordering in `gateway/proxy-routes-agents-token.ts` need hardening. Filed from external code-review observations during BL-020's PR review; confirmed all three are pre-existing (not introduced by BL-020) and already partially documented, so kept out of that PR to avoid violating its "preserve existing behavior exactly" acceptance criterion.
- **Backlog: BL-034 closed out, concurrent-trust wording dropped** — removed the now-decided `BL-034` entry from `backlog.md`'s open P0 list per the file's own completed-item rule; dropped the satisfied `BL-034` dependency from `BL-020`, `BL-021`, `BL-022`, and `BL-030`; replaced "concurrent trust" acceptance wording on `BL-021`/`BL-022` with the single-active-provider decision from the new design spec
- **Backlog: BL-019 marked done** — removed the completed `BL-019` (JwtValidator extraction, shipped in PR #158) entry from `backlog.md`'s open P0 list per the file's own completed-item rule; dropped the now-satisfied `BL-019`/`BL-015` dependency references from `BL-020`, `BL-034`, and `BL-041` so `BL-034` (multi-issuer IdP trust model decision) shows as unblocked
- **Backlog planning intake (BL-024/BL-040/BL-041 + BL-021 sequencing note)** — rewrote BL-024 from docker-compose packaging to a k3d-based ephemeral CI workflow skeleton; added BL-040 to extend that workflow into a per-IdP matrix harness (Auth0/Keycloak/Entra as adapters land); added BL-041 for Keycloak `JwtValidator` + `IdpAdapter` implementation sequenced between Auth0 and Entra work; updated BL-021 source with explicit sequencing rationale (after BL-041 for lessons learned, not a hard dependency)
- **BL-024 acceptance criteria alignment** — updated backlog acceptance text to reflect shipped behavior in the ephemeral workflow (real Auth0 test secrets with per-run ephemeral operator client/grant creation and teardown cleanup), removing stale demo/guest-token-only wording
- **Ephemeral Auth0 smoke path alignment** — updated the k3d workflow smoke checks to exercise the real operator flow (`POST /agents` create, `POST /agents/:clientId/token` vend, `DELETE /agents/:clientId` cleanup) instead of relying on pre-provisioned read/admin test apps; guard deployment now receives Auth0 management env via Kubernetes secret for this isolated ephemeral lane
- **Ephemeral JWT naming alignment** — updated the k3d workflow, smoke script, and setup docs to use `MCP_JWT_ISSUER`, `MCP_JWT_AUDIENCE`, and `MCP_JWT_JWKS_URL` naming consistently with `scripts/dev.env`, removing issuer/audience alias ambiguity in CI setup
- **Ephemeral Helm invocation cleanup** — removed redundant `-f deploy/ephemeral/values-ci.yaml` from `k3d-ephemeral-auth0` because those values matched chart defaults byte-for-byte; deploy behavior is unchanged

### Fixed

- **Ephemeral workflow startup reliability** — UI container build now compiles `@mcp-tool-guard/gateway` before `@mcp-tool-guard/ui` so workspace type imports resolve during Docker build; `k3d-ephemeral-auth0` now installs `kubectl`/`helm` without Azure setup actions, fails fast with explicit missing-secret errors, and guards cleanup when `k3d` is unavailable so secondary errors do not mask primary failures
- **Ephemeral workflow trigger usability** — removed label-only gating from `.github/workflows/k3d-ephemeral-auth0.yml`; the job now runs on pull request `opened`/`synchronize`/`reopened` events and `workflow_dispatch`, eliminating manual label re-add cycles
- **Ephemeral kv-rest rollout stability** — kv-rest adapter now retries Redis connection on startup instead of crash-looping when Redis is still booting, `/health` reports Redis readiness, and the k3d rollout step now emits deployment/pod/log diagnostics when rollout fails to speed root-cause analysis
- **Ephemeral kv-rest probe auth fix** — `/health` now bypasses bearer auth in the kv-rest adapter so Kubernetes readiness/liveness probes no longer receive `401` and force restart loops
- **Ephemeral smoke auth parity option** — k3d smoke flow now supports `AUTH0_OPERATOR_BEARER_TOKEN` (admin user token) to emulate GUI control-plane behavior; M2M client-credentials remains supported as fallback when bearer token is not provided
- **Ephemeral operator client lifecycle automation** — k3d workflow now creates an Auth0 M2M operator client and `client-grant` at run start (scope `gateway:admin` on `AUTH0_AUDIENCE`) and deletes both during cleanup, removing reliance on long-lived operator client secrets
- **Ephemeral smoke agent-create compatibility** — smoke now defaults test-agent scope to `flights:read` (a typical declared API permission) instead of `demo:noop`, and surfaces the server error returned by `POST /agents` when creation fails
- **Ephemeral control-plane token compatibility** — k3d Helm values now set `MCP_M2M_REVOCATION=false` for the isolated CI lane so temporary operator M2M admin tokens are not rejected as "Agent revoked or deleted" before `/agents` create/vend/delete checks
- **Ephemeral kv-rest probe resilience** — kv-rest now starts its HTTP server immediately, retries Redis connection in the background, exposes `/live` for liveness, and keeps `/health` as Redis-readiness so startup races do not trigger rollout timeouts from early connection-refused probe failures
- **Ephemeral workflow scope reduction** — `.github/workflows/k3d-ephemeral-auth0.yml` pull-request trigger now uses `paths` filters so this heavier lane runs only when files used by the ephemeral stack (workflow, deploy/ephemeral, gateway, ui, smoke script, lockfiles) change
- Corrected stale BL-015 route ownership references in `docs/ARCHITECTURE.md` to point at extracted gateway route modules.

### Removed

- Removed redundant `deploy/ephemeral/values-ci.yaml` no-op override file and its documentation reference in `docs/ephemeral-k3d-ci.md`

## [0.5.0] - 2026-07-15

### Added

- **Grafana dashboard-as-code baseline** — added canonical dashboard storage under `dashboards/grafana/` with `mcp-tool-guard-proxy.dashboard.json` and workflow notes in `dashboards/grafana/README.md` so dashboard query/threshold changes are reviewable in PRs
- **Server registry hardening** — `POST`/`DELETE /servers` now write an audit entry (`__registry:add__` / `__registry:remove__`) with the acting bearer subject, so runtime MCP registration changes are traceable in `/audit`; `POST /servers` reports `persisted: false` and refuses to silently accept a registration when KV is disabled (rolls back the in-memory add on a KV write failure instead of leaving a non-durable entry); `/agents.html` "Remove" button now asks for confirmation before deregistering a server
- Team deck: added `docs/MCPToolGuard-Team-Overview.pptx` for internal project walkthroughs
- Demo deck refresh: updated `docs/overview.pptx` for the latest product walkthrough
- **OpenTelemetry (guard proxy)** — optional OTLP HTTP export via `gateway/telemetry.ts`; manual spans for proxy `tools/call` decisions (allow/deny/pending), `POST /audit/agent`, MCP upstream forward, Gemini LLM; gated on `OTEL_EXPORTER_OTLP_ENDPOINT`; [otel.md](docs/otel.md)

### Changed

- **Repo cleanup (test artifacts)** — removed temporary smoke/test markdown files used during manual validation runs (`*-smoke-*.md`, `test-pk*.md`) to keep the repository root clean
- **BL-015 final slice B (LLM route extraction)** — moved `/llm/complete` handling into `gateway/proxy-routes-llm.ts`; `gateway/proxy-server.ts` now delegates LLM completion routing via `handleLlmCompleteRoute` while preserving existing behavior (`GEMINI_API_KEY` gating, result/error logging, response codes, and HTTP request span wrapping)
- **Grafana dashboard JSON refresh** — checked in latest `dashboards/grafana/mcp-tool-guard-proxy.dashboard.json` from Grafana UI edits (including dashboard metadata and current panel/query state) so observability changes remain versioned and reviewable in PRs
- **OTel ops playbook (Grafana debug row)** — `docs/otel.md` now documents the collapsed telemetry-health debug row (`Error Span Rate`, `Total Span Ingest Rate`, `Span Rate by Name`), a fast no-data decision flow, and latency query caveats (`span.latency_ms` in `ms`, prefer wider ranges for bursty traffic)
- **BL-015 final slice A (MCP route extraction)** — moved `/mcp` and `/:serverId/mcp` enforcement/forwarding path into `gateway/proxy-routes-mcp.ts`; `gateway/proxy-server.ts` now delegates MCP handling via `handleMcpRoute` with behavior preserved (approval queue, token-bypass flow, audit/telemetry, and upstream forwarding contracts unchanged)
- **Backlog intake (BL-039)** — added decision-tracking item for approval-queue bypass semantics against independently guarded upstreams (proxy-layer approval token bypass does not elevate forwarded bearer for upstreams without `upstream_token_env`, e.g. `flight`), including explicit accept-vs-fix decision prompt
- **Local revocation ergonomics** — M2M immediate revocation now auto-enables only when KV is enabled; local no-KV runs default to revocation off to avoid false "Agent revoked or deleted" denials during `/agents.html` demo flow, with explicit override via `MCP_M2M_REVOCATION=true|false`
- **M2M revocation detection hardening** — guard-side deleted-agent enforcement now treats Auth0 M2M tokens as client-id shaped (`sub={clientId}@clients` or `client_id`) even when `gty` is absent, with `gty` retained only as secondary hint; this prevents silent bypass when tenant tokens omit grant-type claim, and the active-agent lookup is now injected server-side so browser bundles do not pull Node-only dependencies
- **Backlog tracking (BL-037/BL-038)** — added P1 follow-ups for Claude Code MCP harness integration guidance (guarded `/ :serverId /mcp` usage, token vending/refresh via headers helper, dual approval expectations) and for multi-agent delegation trust-model hardening (scope attenuation/delegation, parent-child trace correlation, cross-agent injection boundary, and risk-tiered approvals)
- **Agents UI chat-state guardrail** — `ui/src/agents-main.ts` now disables Send unless an agent is selected and initialized, clears Send state when selected agent/runtime is revoked or reset, and shows explicit status guidance instead of silent no-op when sending without an active initialized agent
- **Backlog tracking (BL-036)** — added P1 follow-up for env-gated Auth0 happy-path integration coverage on `POST /agents`, `POST /agents/:clientId/token`, and `POST /token`, with skip-when-no-secrets behavior and cleanup requirements
- **BL-015 slice (agents/token routes + tests)** — extracted `/agents*` and `/token` route handling into `gateway/proxy-routes-agents-token.ts`; delegated agent/token endpoints from `gateway/proxy-server.ts`; expanded gateway tests for `/agents` list + admin auth guards and token-vending-not-configured contracts
- **BL-015 cleanup (dead imports)** — removed stale `/servers` extraction leftovers from `gateway/proxy-server.ts` import block after route logic moved into `gateway/proxy-routes-servers.ts`
- **BL-015 slice (servers routes + tests)** — extracted `/servers` route handling into `gateway/proxy-routes-servers.ts`; delegated server list/add/remove/tools endpoints from `gateway/proxy-server.ts`; expanded gateway tests to cover `/servers` list/auth/add/remove and `/servers/:id/tools` error contracts
- **Backlog tracking (BL-035)** — added P1 item to isolate or explicitly document Render PR preview shared state versus production (KV/Auth0/upstream token scope) after preview validation showed production-shared behavior
- **BL-015 slice (helpers + routes + tests)** — extracted shared proxy HTTP helpers into `gateway/http-helpers.ts`; moved `/audit` and `/pending` route handling into `gateway/proxy-routes-audit.ts` and `gateway/proxy-routes-pending.ts`; reduced `gateway/proxy-server.ts` monolith by delegating to new route modules; expanded gateway baseline tests for `/health`, `/audit`, MCP deny contracts, and pending admin/poll-token flows
- **Backlog tracking (BL-015)** — added explicit execution strategy note to deliver route decomposition in small slices (helpers-first, then one route group at a time) with tests and GUI smoke validation after each slice
- **Backlog tracking (BL-018)** — marked BL-018 as in-progress and clarified this PR delivers the preflight/CORS portion while browser-context deny -> pending -> approve -> retry coverage remains
- **Gateway regression coverage** — added preflight CORS test for `OPTIONS /pending/:id` to assert `X-Pending-Token` remains allowed in `Access-Control-Allow-Headers`, protecting approval polling behavior during route refactors
- **Backlog cleanup follow-up** — aligned BL-022 acceptance with BL-034 trust-model decision and restored BL-030 dependency chain to include BL-020/BL-021 implementation prerequisites
- **Backlog cleanup (post-review)** — trimmed BL-003 acceptance to remaining idempotent-create work, removed BL-005 per-user attribution requirement (moved to BL-030 scope), added BL-034 IdP trust-model decision gate, and aligned BL-020/BL-021/BL-030 dependencies with implementation order
- **Docs cleanup** — removed redundant local README variants (`readme-local.md`, `readme-peter.md`, `readme-peter99.md`, `readme-pk.md`) to keep the root docs surface canonical
- **Backlog: post-0.4.0 next-phase intake** — merged Track 0/1/2/3/4 stories into canonical `backlog.md`; promoted BL-015 decomposition to P0 prerequisite; added dependency links and blocked status on dev-meeting-gated local-dev stories
- **Docs: auth/approval flow consistency pass** — updated summary docs (`demo-proxy`, `cursor-guide`, `kv-design`, `ARCHITECTURE`, `NEXT-STEPS`) to consistently document `pending_poll_token`/`X-Pending-Token` for pending polling, `X-Approval-Token` for approved retry, and bearer requirements on `POST /audit/agent`
- **Backlog: browser CORS regression coverage (BL-018)** — added P1 backlog item to automate browser-context approval polling regression checks (`X-Pending-Token` preflight/CORS + deny->pending->approve->retry path)
- **Docs: approval queue polling auth update** — corrected manual Demo 7 curl flow in `docs/demo-proxy.md` to use `pending_poll_token` via `X-Pending-Token` for `GET /pending/:id`; aligned `docs/cursor-guide.md` wording with hardened pending endpoint behavior (`X-Pending-Token` or `gateway:admin` fallback when enabled)
- **Backlog: BL-017 acceptance clarity** — clarified that admin/control-plane events (`__registry:add__`, `__registry:remove__`, agent lifecycle) belong in a dedicated admin/compliance view, while the default "Server enforcement" panel stays focused on runtime tool-call decisions
- **Backlog: admin/compliance events page (BL-017)** — added P2 backlog item to surface session-less admin actions (registry mutations, agent create/revoke) in a dedicated view, discovered while validating the server-registry audit hardening
- **Backlog: tamper-evident audit receipts (BL-016)** — added P2 backlog item for signed/hashed execution receipts; enterprise roadmap item for audit integrity proof

- **Docs: client-readiness accuracy pass** — `MCP_APPROVAL_QUEUE=true` callout added to CONCEPT.md (limitations table) and README.md (quick start); `POST /llm/complete` route added to guard-proxy.md; ARCHITECTURE.md gains rate limiter, `POST /audit/agent`, `POST /llm/complete`, and `POST /token` in component map; demo-proxy.md Demo 8 gains prod runtime-registration callout for Slack.

### Changed

- **Workflow hardening (changelog policy)** — enforce changelog updates on every non-Dependabot commit in PR CI, add local pre-commit hook install path (`make install-hooks`) and CONTRIBUTING guidance so changelog compliance is proactive instead of last-minute.
- **Demo deck follow-up (PR #115)** — refined `docs/overview.pptx` content/flow for the current proxy enforcement walkthrough.
- **Changelog compliance (docs/post-otel-doc-cleanup)** — add required `Unreleased` entry to satisfy PR changelog check for non-Dependabot contributions.
- **Docs accuracy pass (0.4 follow-up)** — fix `GET /audit` response shape (`sources` array, not `.source` / `guard-proxy`); ARCHITECTURE agent route `:clientId`, `agents-main.ts` line ~441; render-deploy GitHub live vs runtime Slack; CONCEPT authoritative audit on proxy; demo-proxy Demo 5 + gateway-agent anchor
- **Docs: ARCHITECTURE.md comprehensive refresh** — Added GatewayAgent flow (`agents-main.ts` → `proxy-api.ts` → `token-vendor.ts` → `gateway-agent.ts`); expanded component map with agent provisioning; updated system context diagram to show both FlightAgent and GatewayAgent paths; clarified "Today vs next" table with separate rows for FlightAgent (demo) vs GatewayAgent (M2M) with approval queue support
- **Docs cleanup + backlog canonicalization** — removed stray raw notes from `docs/demo-proxy.md`; updated `docs/otel.md` to shipped status with acceptance checklist complete; added `GEMINI_API_KEY` and distributed rate-limit notes in `docs/guard-proxy.md`; refreshed `docs/ARCHITECTURE.md` shipped-state rows; added root `backlog.md` as canonical open-work tracker and cross-linked from README/ROADMAP/NEXT-STEPS

### Fixed

- **Approval polling CORS fix** — added `X-Pending-Token` to proxy CORS `Access-Control-Allow-Headers` so browser approval polling from `/agents.html` can call `GET /pending/:id` without preflight failure
- **BL-001 / BL-002 hardening** — `POST /audit/agent` now requires Bearer with `audit:write` or `gateway:admin` unless explicit trusted demo mode (`MCP_AUDIT_AGENT_TRUSTED_MODE=true`); `GET /pending/:id` now requires a short-lived `pending_poll_token` (or `gateway:admin` when control-plane auth is enabled), with `pending_poll_token` returned in the `202` pending response; approval-poll clients updated accordingly
- **Gateway PR CI coverage** — added gateway auth integration tests (`gateway/tests/proxy-auth.test.mjs`) and wired them into PR CI (`.github/workflows/ci.yml`) so hardening regressions fail in CI
- **OpenTelemetry 0.220 compatibility** — updated `gateway/telemetry.ts` to use the new `BatchLogRecordProcessor({ exporter })` constructor signature required by `@opentelemetry/sdk-logs` 0.220.0
- **Changelog policy (CI workflow)** — Fix YAML syntax error in `changelog.yml`: heredoc `<<EOF` with unindented `$(...)` content broke the YAML block scalar parser; replaced with `<<<` here-string fed from a variable
- **OpenTelemetry 0.219.0 API migration** — Updated `gateway/telemetry.ts` for OTel SDK breaking changes: `new Resource()` → `resourceFromAttributes()` (resources v2.8.0), LoggerProvider `addLogRecordProcessor()` → inline `processors` array (sdk-logs 0.219.0)
- **Changelog policy (CI workflow)** — Exempt Copilot from per-commit CHANGELOG requirement to allow IDE-assisted fixes on Dependabot PRs without blocking
- **Starlette CVE-2026-54282** — Regenerated `servers/flight/uv.lock` to pin Starlette ≥1.3.1 (unvalidated request path handling in authority)
- **ARCHITECTURE.md endpoint reference** — Corrected `POST /agents` endpoint location: `gateway/proxy-api.ts` (non-existent) → `gateway/proxy-server.ts` (actual location)

### Removed

- Removed stray placeholder file `new-test.md`
- Duplicate Flight manifest cleanup — removed stale `servers/flight/servers/flight/requirements.txt` (accidental nested export path)

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

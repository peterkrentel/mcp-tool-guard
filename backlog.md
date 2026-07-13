# Backlog

Canonical tracker for open work. If an item is still in progress, track it here.

Use this file for planning and execution status. Keep shipped history in [CHANGELOG.md](CHANGELOG.md).

## Rules

1. One open item = one row with an owner and acceptance criteria.
2. Update status in this file as part of every PR that changes item state.
3. Move completed items to [CHANGELOG.md](CHANGELOG.md), then remove them here.
4. Keep design detail in docs; keep this file as the decision and execution index.

## Status legend

- `todo` not started
- `in-progress` active work
- `blocked` waiting on dependency/decision
- `done` completed in branch, pending release note

## P0 (next)

- BL-001
  priority: P0
  status: done
  item: Harden agent audit ingest auth (`POST /audit/agent`)
  acceptance: Endpoint requires Bearer (`audit:write` or `gateway:admin`) or trusted mode; demo mode remains explicit
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#production-hardening-priorities-review)
- BL-002
  priority: P0
  status: done
  item: Harden pending token disclosure (`GET /pending/:id`)
  acceptance: Optional Bearer gate or short poll token path for retries; docs updated with threat model
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#production-hardening-priorities-review)
- BL-003
  priority: P0
  status: todo
  item: Auth0 registry hygiene (idempotent agent create and reuse)
  acceptance: Same `(name, serverId, scopes)` returns existing KV record without creating a new Auth0 app; app naming is unique; free-tier limit and cleanup path documented
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#agent-registry--auth0-sync-sketch), post-0.4.0 Track 2 BL-H01
- BL-004
  priority: P0
  status: todo
  item: SDK packaging/distribution path
  acceptance: Package workflow documented and test publish flow validated
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#production-hardening-priorities-review)
- BL-005
  priority: P0
  status: todo
  item: External audit sink integration
  acceptance: Additive sink path (`null`/`http`/`loki`/`otlp`) forwards allow/deny entries; sink failures are non-blocking with error log; existing `/audit` behavior remains
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#production-hardening-priorities-review), post-0.4.0 Track 1 BL-F07
- BL-015
  priority: P0
  status: todo
  item: Decompose proxy-server.ts into route modules
  acceptance: `gateway/proxy-server.ts` reduced to bootstrap/composition; route modules for MCP, agents, servers, pending, audit, LLM, and token; shared HTTP helpers extracted; no route behavior changes for `/health`, `/audit`, `/mcp`, `/:serverId/mcp`, `/agents`, `/servers`, `/pending`, `/token`, `/llm/complete`; preserve CORS, rate limiting, and OTEL wrapping
  owner: unassigned
  source: discussion 2026-06-29, post-0.4.0 Track 0 BL-P01
- BL-019
  priority: P0
  status: todo
  item: Extract JwtValidator interface from ToolGuard
  acceptance: `ToolGuard` consumes injected `JwtValidator`; JWT validation removed from `ToolGuard` internals; dual-trust behavior preserved; `authorize()` behavior unchanged
  owner: unassigned
  source: post-0.4.0 Track 0 BL-P02
  depends_on: BL-015
- BL-020
  priority: P0
  status: todo
  item: IdP adapter interface and Auth0 implementation
  acceptance: Routes depend on `IdpAdapter` interface; Auth0 implementation preserves existing create/revoke/token behavior; provider wiring and `/health` identity reporting align with trust-model decision from BL-034
  owner: unassigned
  source: post-0.4.0 Track 1 BL-F01
  depends_on: BL-015, BL-019, BL-034
- BL-021
  priority: P0
  status: todo
  item: Azure Entra JWT validation and IdP adapter
  acceptance: Entra roles/scp claims map correctly to scopes; invalid/expired Entra token rejected on `tools/call`; provider wiring supports concurrent trust as defined in BL-034; identity docs updated
  owner: unassigned
  source: post-0.4.0 Track 1 BL-F02
  depends_on: BL-020, BL-034
- BL-034
  priority: P0
  status: todo
  item: Decide multi-issuer IdP trust model
  acceptance: Gateway trust model is explicitly defined for concurrent issuer validation (Auth0 M2M and Entra user identity); env/config shape documented; BL-020/BL-021 acceptance stays aligned with this decision before implementation
  owner: unassigned
  source: backlog review 2026-07-13
  depends_on: BL-019
- BL-024
  priority: P0
  status: todo
  item: Deployment packaging with Docker and Compose
  acceptance: `docker build` and `docker run` succeed with minimum config; `docker-compose up` starts with in-memory fallback; image excludes `ui/` and `servers/flight/`; `docs/docker-deploy.md` documents minimum viable setup
  owner: unassigned
  source: post-0.4.0 Track 1 BL-F05

## P1 (important)

- BL-006
  priority: P1
  status: todo
  item: Complete upstream structured errors
  acceptance: Consistent `upstream_unavailable` and mapped upstream failures on tools/call paths
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#tasks)
- BL-007
  priority: P1
  status: todo
  item: GUI-managed upstream secrets
  acceptance: Vendor secrets entered via UI and resolved from encrypted KV at runtime
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#production-hardening-priorities-review)
- BL-010
  priority: P1
  status: todo
  item: Remove embedded flight guard from hosted demo path
  acceptance: Flight is treated as plain MCP behind proxy in prod path; docs and config clearly mark embedded server guard as local/demo-only tech debt
  owner: unassigned
  source: discussion 2026-06-26
- BL-011
  priority: P1
  status: todo
  item: Add session_id attribute on proxy spans
  acceptance: OTel proxy spans include `session_id` (when present) so agent sessions correlate with trace/audit records in Grafana
  owner: unassigned
  source: discussion 2026-06-26
- BL-018
  priority: P1
  status: todo
  item: Add browser CORS regression test for pending poll token
  acceptance: Automated test covers cross-origin `/agents.html` approval polling using `X-Pending-Token` and fails if proxy CORS `Access-Control-Allow-Headers` omits `X-Pending-Token`; include end-to-end deny -> pending -> approve -> retry success path in browser context
  owner: unassigned
  source: production smoke finding 2026-07-07
- BL-022
  priority: P1
  status: todo
  item: Keycloak IdP adapter
  acceptance: Keycloak adapter supports create/delete service-account clients and token vending path; provider wiring and `/health` identity reporting align with trust-model decision from BL-034
  owner: unassigned
  source: post-0.4.0 Track 1 BL-F03
  depends_on: BL-020, BL-034
- BL-023
  priority: P1
  status: todo
  item: LLM provider abstraction
  acceptance: `gemini` path unchanged; `azure-openai` and `anthropic` providers added; `none` disables `/llm/complete` with clean 503; `/health` reports `llm_provider`
  owner: unassigned
  source: post-0.4.0 Track 1 BL-F04
- BL-025
  priority: P1
  status: todo
  item: Deployment packaging with Helm chart
  acceptance: `helm install` succeeds on test cluster; policy configurable via values; readiness/liveness probes on `/health`; sensitive config sourced from Kubernetes Secret
  owner: unassigned
  source: post-0.4.0 Track 1 BL-F06
  depends_on: BL-024
- BL-026
  priority: P1
  status: todo
  item: Environment rationalization and startup validation
  acceptance: Required env vars fail fast with clear errors; optional env vars emit one-time feature-disabled info; minimum viable config documented; `/health` reports feature flags
  owner: unassigned
  source: post-0.4.0 Track 1 BL-F08
- BL-027
  priority: P1
  status: blocked
  item: Claude Desktop stdio shim (transport bridge)
  acceptance: Shim forwards newline JSON-RPC stdin to gateway MCP HTTP and writes stdout responses; `tools/call` includes bearer auth; trace and agent headers added; clean exit on stdin close
  owner: unassigned
  source: post-0.4.0 Track 3 BL-L01
  depends_on: BL-020, BL-021, BL-024, dev meeting decisions
- BL-028
  priority: P1
  status: blocked
  item: Shim token acquisition via Entra SSO path
  acceptance: Token acquisition path selected and implemented (desktop token reuse or device flow); per-user identity preserved in gateway auth
  owner: unassigned
  source: post-0.4.0 Track 3 BL-L02
  depends_on: BL-027, BL-021, dev meeting decisions
- BL-029
  priority: P1
  status: blocked
  item: Entra role-to-scope mapping
  acceptance: `role_mappings` config supported; Entra roles resolve to scopes; explicit scope grants remain backward compatible; unmapped roles deny by default
  owner: unassigned
  source: post-0.4.0 Track 3 BL-L03
  depends_on: BL-020, BL-021, sample token claims
- BL-030
  priority: P1
  status: blocked
  item: Per-user audit attribution
  acceptance: Audit entries include `user_sub` from JWT `sub` or Entra `oid`; M2M uses `client_id` attribution; guest/demo remains distinguishable; sink payload includes `user_sub`
  owner: unassigned
  source: post-0.4.0 Track 3 BL-L04
  depends_on: BL-005, BL-020, BL-021, BL-034, sample token claims
- BL-031
  priority: P1
  status: todo
  item: Multi-MCP per agent via allowedServers enforcement
  acceptance: Agent record supports `allowedServers` array with backward-compatible `serverId` input; unauthorized server access denied pre-scope-check and audited as `server_not_allowed`; `/agents.html` supports configuration
  owner: unassigned
  source: post-0.4.0 Track 4 BL-S01
- BL-032
  priority: P1
  status: todo
  item: Cross-agent trace correlation via parent trace header
  acceptance: `X-Parent-Trace-Id` accepted and propagated; `parent_trace_id` emitted in audit; docs updated with query convention
  owner: unassigned
  source: post-0.4.0 Track 4 BL-S02
  depends_on: BL-031

- BL-016
  priority: P2
  status: todo
  item: Tamper-evident audit receipts (signed/hashed execution records)
  acceptance: After a tool executes, a hash of the audit record (who, tool, result, timestamp) is signed with a private key and stored alongside the record; a verification endpoint allows security teams to prove the log has not been altered
  owner: unassigned
  source: discussion 2026-07-03 — enterprise clients need proof of audit integrity, not just logs

- BL-017
  priority: P2
  status: todo
  item: Admin/compliance events page
  acceptance: Keep `GET /audit` and the main "Server enforcement" panel focused on runtime tool-call decisions; surface control-plane events (e.g. `__registry:add__`, `__registry:remove__`, agent create/revoke) in a dedicated admin/compliance view (or separate audit section/tab) protected by `gateway:admin`; optional debug toggle may include these in unified audit export/view without changing the default session-scoped filter behavior
  owner: unassigned
  source: discussion 2026-07-07 — registry mutation audit entries (added in server-registry hardening) exist server-side but have no dedicated view; session-scoped filter intentionally left unchanged to avoid affecting other audit consumers

## Deferred

- BL-008
  priority: P3
  status: deferred
  item: Multi-server chat UI routing polish
  acceptance: Per-server chat UX expanded without reducing enforcement/audit clarity
  owner: unassigned
  source: [docs/ROADMAP.md](docs/ROADMAP.md#release-030--hardening--multi-server)
- BL-009
  priority: P3
  status: deferred
  item: Second mock MCP
  acceptance: Optional owned upstream added for routing-only demo coverage
  owner: unassigned
  source: [docs/ROADMAP.md](docs/ROADMAP.md#release-030--hardening--multi-server)
- BL-033
  priority: P3
  status: deferred
  item: A2A bridge investigation (no code)
  acceptance: Investigation doc captures feasibility, exposed operations, identity/trust model, and candidate scope model for running an A2A bridge as an upstream MCP server
  owner: unassigned
  source: post-0.4.0 Track 4 BL-S03

## Notes

- Historical planning context remains in [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md).
- New open work should be added here first.

## Completed in this PR (pending release note)

- BL-012
  priority: P1
  status: done
  item: Add `GEMINI_API_KEY` to [docs/guard-proxy.md](docs/guard-proxy.md) environment table
  acceptance: Env table includes Gemini server-side key usage for `POST /llm/complete`
  owner: docs
  source: docs audit 2026-06-26
- BL-013
  priority: P1
  status: done
  item: Remove raw dev notes from EOF of [docs/demo-proxy.md](docs/demo-proxy.md)
  acceptance: No pasted ad-hoc tool-call notes remain in published demo script
  owner: docs
  source: docs audit 2026-06-26
- BL-014
  priority: P1
  status: done
  item: Update [docs/otel.md](docs/otel.md) acceptance and stale branch wording
  acceptance: Acceptance checklist is checked and branch-pending note replaced with shipped status text
  owner: docs
  source: docs audit 2026-06-26

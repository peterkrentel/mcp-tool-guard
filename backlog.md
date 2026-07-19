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

- BL-037
  priority: P1
  status: todo
  item: Claude Code harness integration guide for guarded MCP endpoints
  acceptance: Document and smoke-test Claude Code configuration for guarded upstream access via `POST /:serverId/mcp` (example `claude mcp add .../github/mcp` with bearer auth), including token vending flow (`/agents/:clientId/token` or `/token`), token refresh via `headersHelper`, and expected dual approval behavior (Claude local tool approval plus gateway scope/pending approval)
  owner: unassigned
  source: design note 2026-07-14 — guard proxy is MCP-contract compatible and should be harness-agnostic across browser, curl/M2M, and Claude Code clients

- BL-038
  priority: P1
  status: todo
  item: Multi-agent delegation trust model and guard policy extension
  acceptance: Define parent/subagent delegation model (scope attenuation vs independently minted JWT per subagent), add parent/child trace correlation fields, document cross-agent prompt-injection risks and mitigation boundaries, and propose risk-tiered approval policy for high-volume autonomous tool calls (instead of per-call human approval only)
  owner: unassigned
  source: threat-model note 2026-07-14 — moving from single-agent loops to orchestrated subagents introduces agent-to-agent trust boundaries not covered by current harness-to-tool enforcement
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
- BL-021
  priority: P0
  status: todo
  item: Azure Entra JWT validation and IdP adapter
  acceptance: Entra roles/scp claims map correctly to scopes; invalid/expired Entra token rejected on `tools/call`; provider wiring supports selection as the single active `MCP_IDP_PROVIDER=entra` per BL-034 (not concurrent trust); identity docs updated
  owner: unassigned
  source: post-0.4.0 Track 1 BL-F02; sequencing note 2026-07-15 - intentionally scheduled after BL-041 (not a hard dependency) to apply second-adapter lessons before Entra Azure/Graph integration
  depends_on: BL-020
- BL-024
  priority: P0
  status: todo
  item: Dockerfiles + k3d ephemeral CI workflow for guard proxy and flight server
  acceptance: Dockerfiles exist for `gateway/` and `servers/flight/`; a GitHub Actions workflow (workflow_dispatch or PR-label triggered, not on every push) builds both images, spins up a k3d cluster, imports the images directly (no registry needed), applies Deployment/Service manifests, waits for rollout, runs smoke checks against the cluster's exposed UI/guard endpoints, and tears the cluster down; workflow uses real Auth0 test secrets to create an ephemeral Management API operator client for the run and cleans up the grant/client during teardown; kept as a separate workflow from `ci.yml` so the fast typecheck/test PR feedback loop is untouched
  owner: unassigned
  source: design discussion 2026-07-15 - k3d chosen over bare k3s for CI (no special runner privileges needed); docker-compose dropped as redundant with existing `make dev` local-dev story

- BL-041
  priority: P0
  status: todo
  item: Keycloak JwtValidator and IdpAdapter implementation
  acceptance: `KeycloakJwtValidator` implements the `JwtValidator` interface from BL-019 (JWKS-based, Keycloak realm token endpoint); claims-mapping handles Keycloak's role shape (`realm_access.roles` / `resource_access` nested client roles) distinct from Auth0's flat scope/permissions claims; `KeycloakIdpAdapter` implements the `IdpAdapter` interface from BL-020 (client registration via Keycloak Admin REST API); deliberately built before BL-021 (Entra) specifically to validate the BL-019/BL-020 abstractions generalize to a second real provider before the higher-stakes Entra integration; reference existing Azure-hosted Keycloak workflow for deployment/testing pattern
  owner: unassigned
  source: design discussion 2026-07-15 - sequenced ahead of BL-021 to de-risk the Entra work with lessons learned from a self-hosted provider first
  depends_on: BL-020

## P1 (important)

- BL-043
  priority: P1
  status: todo
  item: Re-approving an already-approved pending request mints a redundant valid approval token
  acceptance: `POST /pending/:id/approve` on a pending request that is already `status: approved` either no-ops (returns the existing approval token/state without minting a new one) or rejects with a clear error, instead of silently calling `generateApprovalToken()` again; add a regression test asserting a second approve call on the same pending id does not produce a second independently-valid `X-Approval-Token`
  owner: unassigned
  source: discovered 2026-07-19 during BL-020 deployed smoke test follow-up — user approved the same GitHub `create_or_update_file` pending request (`pr_...`) twice via `/agents.html`'s approval queue panel on the deployed proxy; `gateway/pending-store.ts` confirmed each token is still correctly single-use/burned on validation (`validateApprovalToken`, no replay of the same token), but `generateApprovalToken` has no guard against being called again for an already-approved pending id, so two independent valid tokens existed for one pending request and both were successfully redeemed (two "allow ... Pending request approved" audit entries for the same pending id); not a token-replay bug, but a missing idempotency guard on repeated approval
- BL-042
  priority: P1
  status: todo
  item: Document and harden control-plane auth trust model
  acceptance: `docs/ARCHITECTURE.md` (or `guard-proxy.md`) explicitly documents that `control_plane_auth` (admin-gating for `/agents`, `/servers`, `/pending`) is conditional on JWT trust config being present (`adminAuthRequired()` in `gateway/admin-auth.ts`), including the operational risk of deploying without JWT trust configured; decide whether `GET /agents` should require `gateway:admin` (currently intentionally open — metadata only, no secrets — per existing `guard-proxy.md` route table) or stay as-is with the rationale made explicit; decide whether the vending-config-check-before-admin-auth-check ordering in `gateway/proxy-routes-agents-token.ts` (`POST /token`, `POST /agents/:clientId/token`) should be reordered to avoid revealing `AUTH0_DOMAIN`/`AUTH0_AUDIENCE` configuration state to unauthenticated callers, or is acceptable given `/health` already exposes the same booleans unauthenticated; add a guardrail test asserting the desired behavior for "guard enabled + partial JWT trust config" (currently untested)
  owner: unassigned
  source: external code review (VS Code Copilot) during BL-020 PR review 2026-07-19 — all three observations confirmed pre-existing (present in the codebase before BL-020, not introduced by it) and are already partially documented (guard-proxy.md route table, /health field, UI "control plane auth is off" banner) rather than undocumented; filed as its own item since fixing it in BL-020 would violate that PR's own "preserve existing behavior exactly" acceptance criterion
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
  status: in-progress
  item: Add browser CORS regression test for pending poll token
  acceptance: Preflight/CORS regression guard is added (`OPTIONS /pending/:id` asserts `X-Pending-Token` in `Access-Control-Allow-Headers`); remaining scope is automated browser-context `/agents.html` deny -> pending -> approve -> retry success path
  owner: unassigned
  source: production smoke finding 2026-07-07; partial delivered in test/pending-cors-regression PR
- BL-022
  priority: P1
  status: todo
  item: Keycloak IdP adapter
  acceptance: Keycloak adapter supports create/delete service-account clients and token vending path; provider wiring and `/health` identity reporting implemented per BL-034's single-active-provider design
  owner: unassigned
  source: post-0.4.0 Track 1 BL-F03
  depends_on: BL-020
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
  depends_on: BL-005, BL-020, BL-021, sample token claims
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
- BL-035
  priority: P1
  status: todo
  item: Isolate or document Render preview environment shared state
  acceptance: Render PR preview environments (`render.yaml` `previews.generation: automatic`) either get their own `KV_REST_API_URL`/`KV_REST_API_TOKEN` (and other env-scoped secrets) separate from Production, or - if kept shared for cost/simplicity - `docs/render-deploy.md` explicitly documents that preview deploys read/write the same KV store, Auth0 management app, and upstream tokens as prod, so PR reviewers know not to treat preview URLs as sandboxed for approval-queue/audit testing
  owner: unassigned
  source: discovered 2026-07-14 during BL-015 PR-150 preview validation - `/health` on `pr-150.onrender.com` showed `kv_enabled:true` and a dynamically-registered `slack-prod` server not present in `config.prod.yaml`, indicating it reads the same KV store as Production; `render.yaml` has no separate Preview-scoped env vars for any of `KV_REST_API_URL`/`KV_REST_API_TOKEN`, `AUTH0_MGMT_*`, `GEMINI_API_KEY`, `SLACK_MCP_TOKEN`, `GITHUB_MCP_TOKEN`

- BL-036
  priority: P1
  status: todo
  item: Add env-gated Auth0 happy-path integration coverage for `/agents` and `/token`
  acceptance: Add integration tests that exercise successful Auth0-backed `POST /agents`, `POST /agents/:clientId/token`, and `POST /token` paths when dedicated test env vars are present; tests are skipped (not failed) when Auth0 integration env is absent; tests clean up created Auth0 apps/agents; CI keeps deterministic non-network auth tests as baseline and runs Auth0 integration tests only in secrets-enabled job/environment
  owner: unassigned
  source: BL-015 slice review 2026-07-14 - route decomposition tests cover auth gates and not-configured paths, but real Auth0 happy-path behavior remains unverified in automated tests

- BL-040
  priority: P1
  status: todo
  item: Extend k3d CI workflow (BL-024) into a per-IdP-provider test matrix
  acceptance: The BL-024 workflow becomes a GitHub Actions matrix job with one leg per supported IdP adapter (Auth0, Keycloak, Entra - added incrementally as each adapter lands, not all at once); each leg deploys the gateway configured for that one provider and runs the same smoke test against it; Keycloak leg runs Keycloak itself as an in-cluster pod (no external account/secrets needed); Auth0 and Entra legs use repo/org-level CI secrets scoped to test-only credentials; a leg is only added to the matrix once its corresponding `IdpAdapter` exists - this item grows across BL-020/BL-041/BL-021 rather than landing whole
  owner: unassigned
  source: design discussion 2026-07-15 - recognized the CI matrix doubles as the actual verification mechanism for `IdpAdapter` implementations, replacing manual GUI smoke-testing per provider
  depends_on: BL-024

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

- BL-039
  priority: P2
  status: todo
  item: Approval-queue bypass doesn't propagate to upstreams with their own scope enforcement
  acceptance: Document (and decide whether to fix) that the proxy's `X-Approval-Token` bypass only lifts the proxy's own guard check — for upstream MCP servers without `upstream_token_env` configured (no vendor-credential substitution, e.g. `flight`), the original scope-limited bearer is forwarded unchanged, so an upstream running its own independent guard (`servers/flight`) re-denies after proxy approval. Servers with `upstream_token_env` (`github`, `slack-prod`) are unaffected since the proxy substitutes its own vendor PAT. Decide: is this acceptable (approval queue is a proxy-layer control, not meant to override upstream-owned policy) or does it need a fix (e.g. proxy re-signs/elevates the forwarded credential post-approval)?
  owner: unassigned
  source: discovered 2026-07-15 during BL-015 MCP route extraction smoke test — `scripts/smoke-approval.sh` step 3 fails against local flight upstream specifically; confirmed pre-existing (`buildReqHeadersWithUpstreamAuth` unchanged by extraction), not a regression

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
- BL-015 execution strategy: ship in small slices (helpers-first), then move one route group at a time with gateway tests and GUI smoke validation after each slice.


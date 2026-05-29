# Roadmap

**Navigation:** [Quick start](../README.md) · [Live demo](vercel-deploy.md#live-demo) · [Vercel deploy](vercel-deploy.md) · [Next steps](NEXT-STEPS.md) · [Design (CONCEPT)](CONCEPT.md) · [Changelog](../CHANGELOG.md)

Planned work and release tasks. Shipped changes are listed in [CHANGELOG.md](../CHANGELOG.md). Architecture and audit model: [CONCEPT.md](CONCEPT.md) only — not duplicated here.

**Current release:** [0.2.0](RELEASE.md#020-remote--server-auth) — remote deploy, server JWT guard, CORS to UI origin.

**Next release:** [0.3.0 — Hardening & multi-server](#release-030--hardening--multi-server) — see [NEXT-STEPS.md](NEXT-STEPS.md).

## Product shape (summary)

- **0.x** — Reference demo: enforce + audit at MCP `tools/call` (`session_id`, `trace_id`).
- **Audit UI** — Two panels; details in [CONCEPT → Two audit planes](CONCEPT.md#two-audit-planes-demo-ui).
- **Production (Tier 2+)** — Server guard JSON to your observability stack; Grafana/SIEM replaces the in-app panel; optional **guard proxy** in front of external MCP.

---

## Release 0.2.0 — Remote & server auth {#release-020--remote--server-auth}

Deploy like production: external MCP URL, HTTPS, server enforcement for any client (browser, CLI).

| # | Task | Status |
|---|------|--------|
| 1 | Deploy flight MCP to Vercel | Done — [health](https://mcp-tool-guard-flight-server.vercel.app/health) |
| 2 | Deploy UI; `VITE_MCP_URL` → remote flight | Done — [UI](https://mcp-tool-guard-ui.vercel.app/) |
| 3 | `Authorization: Bearer` on every MCP request | Done |
| 4 | JWT + per-tool scopes on flight server | Done |
| 5 | Tighten CORS to UI origin(s) | Done — defaults + `MCP_CORS_ORIGINS` override |
| 6 | Deploy docs ([vercel-deploy.md](vercel-deploy.md), README live links) | Done |
| 7 | CHANGELOG `0.2.0` + version bump + tag `v0.2.0` | Done — tag `v0.2.0` on `main` |

**Out of scope for 0.2.0:** IdP login, multi-server routing, LangChain, MCP elicitation, real airline APIs.

**Security:** HTTPS + Bearer JWT scopes for browser → MCP. See [vercel-deploy.md](vercel-deploy.md) and [CONCEPT → Remote deployment](CONCEPT.md#remote-deployment).

---

## Release 0.3.0 — Hardening & multi-server {#release-030--hardening--multi-server}

Post–peer-review hardening for the demo deploy plus client-side multi-server scoping. **Enforcement core stays as-is** — scope middleware, RS256, `trace_id`; harden around it only.

**Ship first (public Vercel):** **#1 + #2 + #3 in one PR**, then **#4** (KV). See [NEXT-STEPS → Phase A–B](NEXT-STEPS.md#phase-a--public-deploy-hygiene-pr-1).

**Out of scope for 0.3:** Shorter demo token expiry or token rotation — static `demo-tokens.json` stays until **Tier 2 IdP** replaces it.

### High — demo deploy & security hygiene

| # | Task | Notes | Priority |
|---|------|--------|----------|
| 1 | Authenticate `GET /audit` or disable on public deploy | Unauthenticated today; exposes scopes, session/trace IDs | **First** |
| 2 | `MCP_GUARD_ENABLED=false` fail-closed or loud startup warning | Silent kill switch is a prod misconfig risk | **First** (with #1) |
| 3 | UI: show when server audit fetch fails | `fetchServerAudit` returns `[]` on any error today | **First** (with #1) |
| 4 | Durable server audit (Vercel KV / Redis) | Fixes serverless instance split | After #1–#3 |
| 5 | JWT `iss` / `aud` validation (env-configured) | Required **before** IdP / multi-purpose keys | Phase C |

### Medium — correctness & ops

| # | Task | Notes |
|---|------|--------|
| 6 | Single policy source + CI drift test | Today: `guard_config.yaml`, `gateway/config.yaml`, `ui/guard-config.ts` |
| 7 | Middleware max request body size | DoS: unbounded body read in `guard_middleware.py` |
| 8 | Multi-server UI | Wire `gateway/config.yaml` servers; `authorize(server, …)` + per-URL MCP client |
| 9 | Second mock MCP (`servers/notes/`) | Prove multi-server policy on infra you control |
| 10 | Document prompt-injection mitigations | e.g. `sanitizeCancelBookingArgs` requires user text |

### Larger — production shape (may spill to Tier 2)

| # | Task | Notes |
|---|------|--------|
| 11 | **Guard HTTP proxy** | Client → your gateway → upstream MCP; authoritative log for “remote” vendors |
| 12 | Rate limiting | Per-token / per-IP on MCP and `/audit` |
| 13 | Guard `initialize` / `tools/list` (optional auth) | Capability enumeration today is open |

Details and priority order: [NEXT-STEPS.md](NEXT-STEPS.md).

---

## Tier 2 — Product depth (post-0.3)

| Item | Notes |
|------|--------|
| IdP integration | Replace `demo-tokens.json` with OAuth/OIDC; short-lived issuer-minted tokens (no 0.3 token-rotation work) |
| JWKS verification | Server / SDK load issuer JWKS (`iss` / `aud` aligned) |
| Audit export / observability sink | OTel, Loki, Datadog; server guard JSON ([CONCEPT → Observability scope](CONCEPT.md#observability-scope)) |
| Python audit `LogSink` | Parity with TypeScript `AuditLogger` sinks |
| LangChain / backend agent | Guarded MCP from a service, not only browser |

---

## Tier 3 — Optional

| Item | Notes |
|------|--------|
| MCP elicitation | Server `elicit()` + client callback |
| MCP CLI / Cursor docs | `mcp.json` for HTTP flight server |
| UX polish | IATA false positives, empty-search messaging |

---

## How to use this doc

1. Pick a task above.
2. Branch + PR per [CONTRIBUTING.md](../CONTRIBUTING.md).
3. Add [CHANGELOG.md](../CHANGELOG.md) under `[Unreleased]`.
4. Check off here when merged (or move bullets into CHANGELOG on release).

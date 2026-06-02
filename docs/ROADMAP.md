# Roadmap

**Navigation:** [Quick start](../README.md) · [Live demo](vercel-deploy.md#live-demo) · [Identity](identity.md) · [Auth0 setup](auth0-setup.md) · [Next steps](NEXT-STEPS.md) · [Design (CONCEPT)](CONCEPT.md) · [Changelog](../CHANGELOG.md)

Planned work and release tasks. Shipped changes: [CHANGELOG.md](../CHANGELOG.md). Architecture: [CONCEPT.md](CONCEPT.md).

**Current release:** [0.3.1 shipped](#release-031--demo-polish) — WebLLM heuristics + read-only demo docs (tag `v0.3.1`). Prior: [0.3.0](#release-030--hardening--multi-server).

**Next:** [Implementation backlog](NEXT-STEPS.md#implementation-backlog-post-030) — **#8** policy drift (suggested), then #7, #9–10.

## Product shape (summary)

- **0.x** — Enforce + audit at MCP `tools/call` (`session_id`, `trace_id`).
- **Pitch** — Bring your IdP; we enforce scopes at the AI tool layer.
- **Production (Tier 2+)** — Keycloak/Azure AD (same JWKS path), observability sink, guard proxy for unowned MCP.

---

## Release 0.2.0 — Remote & server auth {#release-020--remote--server-auth}

| # | Task | Status |
|---|------|--------|
| 1 | Deploy flight MCP to Vercel | Done |
| 2 | Deploy UI; `VITE_MCP_URL` → remote flight | Done |
| 3 | `Authorization: Bearer` on every MCP request | Done |
| 4 | JWT + per-tool scopes on flight server | Done |
| 5 | Tighten CORS to UI origin(s) | Done |
| 6 | Deploy docs | Done |
| 7 | Tag `v0.2.0` | Done |

---

## Release 0.3.1 — Demo polish {#release-031--demo-polish}

**Shipped 2026-06-02** — tag `v0.3.1`. WebLLM heuristics (#11), read-only scope demo screenshots, planning doc sync.

---

## Release 0.3.0 — Identity, hardening & multi-server {#release-030--hardening--multi-server}

**Shipped 2026-06-02** — tag `v0.3.0`. Phases A (Auth0) + B (KV) complete on prod.

**Next:** [NEXT-STEPS → Implementation backlog](NEXT-STEPS.md#implementation-backlog-post-030).

### High — identity & public deploy

| # | Task | Notes | Priority |
|---|------|--------|----------|
| 1 | Auth0 login **+ guest demo** | Dual trust: JWKS + PEM | **Done** |
| 2 | JWKS + `iss` / `aud` on flight + SDK | PEM fallback for guest/CI | **Done** |
| 3 | `GET /audit` requires Bearer JWT | Same token as MCP | **Done** |
| 4 | `MCP_GUARD_ENABLED=false` warning | Loud startup log | **Done** |
| 5 | UI: server audit fetch errors visible | Error banner in audit panel | **Done** |
| 6 | Durable server audit + bookings (Vercel KV) | [kv-design.md](kv-design.md) | **Done** |

### Medium — correctness & multi-server

| # | Task | Notes |
|---|------|--------|
| 7 | Middleware max request body size | DoS: unbounded body in middleware |
| 8 | Single policy source + CI drift test | `guard_config.yaml`, `gateway/config.yaml`, `ui/guard-config.ts` |
| 9 | Multi-server UI | `authorize(server, …)` + per-URL MCP client |
| 10 | Second mock MCP (`servers/notes/`) | Multi-server on infra you own |
| 11 | WebLLM heuristics + anti-hallucination | `tool-args.ts`, `agent.ts` — **Done** (PR #22, on `main`) |

### Larger — Tier 2 (may follow 0.3)

| # | Task | Notes |
|---|------|--------|
| 12 | **Guard HTTP proxy** | Unowned upstream MCP — [CONCEPT](CONCEPT.md#third-party--unowned-mcp) |
| 13 | Rate limiting | MCP + `/audit` |
| 14 | Guard `initialize` / `tools/list` (optional auth) | Capability enumeration |

### Not doing in 0.3

- Toy **`MCP_AUDIT_SECRET`** — use IdP token for `/audit` instead ([identity.md](identity.md))
- Shorter demo token expiry — IdP replaces static JWTs
- Real Slack/GitHub MCP without proxy

---

## Tier 2 — Product depth (post-0.3)

| Item | Notes |
|------|--------|
| **Keycloak / Azure AD** | Same `MCP_JWT_*` env as Auth0; enterprise demo |
| Audit export / observability sink | OTel, Loki, Datadog |
| Python audit `LogSink` | Parity with TypeScript sinks |
| LangChain / backend agent | Guarded MCP outside browser |

---

## Tier 3 — Optional

| Item | Notes |
|------|--------|
| MCP elicitation | Server `elicit()` + client callback |
| MCP CLI / Cursor docs | `mcp.json` for HTTP flight |
| UX polish | IATA false positives, empty-search messaging |

---

## How to use this doc

1. Pick a task above.
2. Branch + PR per [CONTRIBUTING.md](../CONTRIBUTING.md).
3. Update [CHANGELOG.md](../CHANGELOG.md) under `[Unreleased]`.
4. Check off when merged.

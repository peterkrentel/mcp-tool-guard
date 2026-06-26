# Roadmap

**Navigation:** [Deploy overview](deploy-overview.md) · [Quick start](../README.md) · [Architecture](ARCHITECTURE.md) · [Live demo](vercel-deploy.md#live-demo) · [Identity](identity.md) · [Auth0 setup](auth0-setup.md) · [Next steps](NEXT-STEPS.md) · [**Cursor guide**](cursor-guide.md) · [Design (CONCEPT)](CONCEPT.md) · [Changelog](../CHANGELOG.md)

Planned work and release tasks. Shipped changes: [CHANGELOG.md](../CHANGELOG.md). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) · [CONCEPT.md](CONCEPT.md).

**Current release:** `0.4.0` shipped — KV persistence, GitHub MCP upstream, approval queue (tag `v0.4.0`). Prior release: `0.3.1`.

> Canonical open-work tracker: [backlog.md](../backlog.md). Use this doc for roadmap context and release framing.

**Implementation status:** Tracks 1–3 are shipped on `main` — KV registry + agents, GitHub MCP upstream, and approval queue ([track2-github-proof.md](track2-github-proof.md), [track3-approval-queue-proof.md](track3-approval-queue-proof.md)). Summary: [NEXT-STEPS → three tracks](NEXT-STEPS.md#cursor-guide-three-tracks). **Deferred:** #9/#10.

**Next focus:** post-Track-3 hardening — Auth0 registry hygiene, audit export, SDK packaging, and broader backend-agent deployment patterns.

## Product shape (summary)

**One-liner:** Policy-enforced MCP gateway with verifiable scoped agent execution.

- **0.x** — Enforce + audit at MCP `tools/call` (`session_id`, `trace_id`).
- **Pitch** — Bring your IdP; we enforce scopes at the AI tool layer.
- **Production (Tier 2+)** — Keycloak/Azure AD (same JWKS path), observability sink, guard proxy for unowned MCP.

### Differentiators

| Moat | What it means |
| ---- | ------------- |
| **Authoritative enforcement** | Proxy/server denies before upstream MCP runs — not prompt promises |
| **Auditable execution** | Every `tools/call` → structured allow/deny + `trace_id` replay via `GET /audit` |
| **BYO IdP, scope-per-tool policy** | `gateway/config.yaml` maps tools → scopes; issuer-agnostic JWKS path |
| **Control vs runtime identity** | Operators provision with `gateway:admin`; agents run with narrow M2M tool scopes |
| **MCP-native gateway** | One enforcement layer in front of any upstream MCP URL |
| **On-demand scope** | Approval queue — agent lacks scope → human approves → short-lived token → retry ([Track 3 proof](track3-approval-queue-proof.md)) |

Canonical proof: [demo-proxy.md](demo-proxy.md) (curl deny + `/audit`), not chat quality.

### Build filter {#build-filter}

Before adding scope, ask: **does this strengthen enforcement + audit credibility, or only demo UX?**

| Ship | Defer |
| ---- | ----- |
| [Three tracks](cursor-guide.md): KV registry, GitHub MCP, approval queue | Extra mock MCP servers (#9/#10) |
| Structured upstream errors, registry hygiene | Proxy audit UI chrome, path banners |
| Demo script that replays allow/deny + audit | UI-only polish that does not change enforcement credibility |

---

## Release 0.2.0 — Remote & server auth {#release-020--remote--server-auth}

| # | Task | Status |
| - | ---- | ------ |
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
| - | ---- | ----- | -------- |
| 1 | Auth0 login **+ guest demo** | Dual trust: JWKS + PEM | **Done** |
| 2 | JWKS + `iss` / `aud` on flight + SDK | PEM fallback for guest/CI | **Done** |
| 3 | `GET /audit` requires Bearer JWT | Same token as MCP | **Done** |
| 4 | `MCP_GUARD_ENABLED=false` warning | Loud startup log | **Done** |
| 5 | UI: server audit fetch errors visible | Error banner in audit panel | **Done** |
| 6 | Durable server audit + bookings (Vercel KV) | [kv-design.md](kv-design.md) | **Done** |

### Medium — correctness & multi-server

| # | Task | Notes |
| - | ---- | ----- |
| 7 | Middleware max request body size | DoS: unbounded body in middleware |
| 8 | Policy from `gateway/config.yaml` in UI + demo alignment CI | **Done** — `ui/guard-config.ts` imports yaml; `check:demo-policy` until #12 |
| 9 | Multi-server UI | `authorize(server, …)` + per-URL MCP client — **deferred** |
| 10 | Second mock MCP | Optional owned upstream for routing tests — **deferred** |
| 11 | WebLLM heuristics + anti-hallucination | `tool-args.ts`, `agent.ts` — **Done** (PR #22, on `main`) |

### Larger — Tier 2 (may follow 0.3)

| # | Task | Notes |
| - | ---- | ----- |
| 12 | **Guard HTTP proxy** | **Done** — code on `main`, **deployed on Render** — [render-deploy](render-deploy.md), [demo-proxy](demo-proxy.md), [CONCEPT](CONCEPT.md#third-party--unowned-mcp) |
| 13 | Rate limiting | MCP + `/audit` |
| 14 | Guard `initialize` / `tools/list` (optional auth) | Capability enumeration |

### Not doing in 0.3

- Toy **`MCP_AUDIT_SECRET`** — use IdP token for `/audit` instead ([identity.md](identity.md))
- Shorter demo token expiry — IdP replaces static JWTs
- Real Slack MCP without proxy (GitHub via guard proxy is **done** — [track2-github-proof](track2-github-proof.md))

---

## Tier 2 — Product depth (post-0.3)

| Item | Notes |
| ---- | ----- |
| **Keycloak / Azure AD** | Same `MCP_JWT_*` env as Auth0; enterprise demo |
| Audit export / observability sink | OTel, Loki, Datadog |
| Python audit `LogSink` | Parity with TypeScript sinks |
| LangChain / backend agent | Guarded MCP outside browser |
| Proxy audit persistence | Persist `gateway:audit:*` in KV (survive restarts/redeploys) |
| Distributed rate limiting | KV-backed limiter for multi-instance proxy correctness |
| SDK packaging | Publish guard package for external agent integrations |

---

## Tier 3 — Optional

| Item | Notes |
| ---- | ----- |
| MCP elicitation | Server `elicit()` + client callback |
| MCP CLI / Cursor docs | `mcp.json` for HTTP flight |
| UX polish | IATA false positives, empty-search messaging |

## Near-term execution notes

1. Prioritize Auth0 registry sync and client reuse before scaling agent creation.
2. Prioritize audit export and SDK packaging before broader production claims.
3. Keep multi-server UI expansion behind hardening work.

---

## How to use this doc

1. Pick a task above.
2. Branch + PR per [CONTRIBUTING.md](../CONTRIBUTING.md).
3. Update [CHANGELOG.md](../CHANGELOG.md) under `[Unreleased]`.
4. Check off when merged.

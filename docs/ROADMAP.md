# Roadmap

**Navigation:** [Quick start](../README.md) · [Design (CONCEPT)](CONCEPT.md) · [Changelog](../CHANGELOG.md)

Planned work and release tasks. Shipped changes are listed in [CHANGELOG.md](../CHANGELOG.md). Architecture and audit model: [CONCEPT.md](CONCEPT.md) only — not duplicated here.

**Current release:** [0.1.0](RELEASE.md#010) — local demo (flight MCP, WebLLM UI, client SDK + server guard).

**Next release:** [0.2.0 — Remote & server auth](RELEASE.md#020-remote--server-auth).

## Product shape (summary)

- **0.x** — Reference demo: enforce + audit at MCP `tools/call` (`session_id`, `trace_id`).
- **Audit UI** — Two panels; details in [CONCEPT → Two audit planes](CONCEPT.md#two-audit-planes-demo-ui).
- **Production (Tier 2+)** — Server guard JSON to your observability stack; Grafana/SIEM replaces the in-app panel.

---

## Release 0.2.0 — Remote & server auth

Deploy like production: external MCP URL, HTTPS, server enforcement for any client (browser, CLI).

| # | Task | Status |
|---|------|--------|
| 1 | Deploy flight MCP to Vercel; document URL (`/mcp`) | Not started |
| 2 | Deploy UI static build; set `VITE_MCP_URL` to remote flight | Not started |
| 3 | `Authorization: Bearer` on every MCP request | Done |
| 4 | JWT + per-tool scopes on flight server | Done |
| 5 | Tighten CORS to UI origin(s) | Not started |
| 6 | README deploy section complete | In progress |
| 7 | On release: move CHANGELOG `[Unreleased]` → `0.2.0` | Not started |

**Out of scope for 0.2.0:** IdP login, multi-server routing, LangChain, MCP elicitation, real airline APIs.

**Security:** HTTPS + Bearer JWT scopes for browser → MCP. See [CONCEPT → Remote deployment](CONCEPT.md#remote-deployment).

---

## Tier 2 — Product depth (post-0.2.0)

| Item | Notes |
|------|--------|
| IdP integration | Replace `demo-tokens.json` with OAuth/OIDC |
| JWKS verification | Server / SDK load issuer JWKS |
| Multi-server UI | Wire slack/github stubs in `gateway/config.yaml` |
| Audit export / observability sink | OTel, Loki, Datadog; server guard JSON ([CONCEPT → Observability scope](CONCEPT.md#observability-scope)) |
| Second mock MCP | Optional `servers/notes/` for multi-server policy |

---

## Tier 3 — Optional

| Item | Notes |
|------|--------|
| LangChain agent service | Backend agent with guarded MCP |
| MCP elicitation | Server `elicit()` + client callback |
| MCP CLI / Cursor docs | `mcp.json` for HTTP flight server |
| UX polish | IATA false positives, empty-search messaging |

---

## How to use this doc

1. Pick a task above.
2. Branch + PR per [CONTRIBUTING.md](../CONTRIBUTING.md).
3. Add [CHANGELOG.md](../CHANGELOG.md) under `[Unreleased]`.
4. Check off here when merged (or move bullets into CHANGELOG on release).

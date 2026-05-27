# Roadmap

Planned work for MCPToolGuard. Track progress here and in [CHANGELOG.md](../CHANGELOG.md) under `[Unreleased]`.

**Current release:** [0.1.0](RELEASE.md#010) — local demo (browser guard, flight MCP, mock data).

**Next release:** [0.2.0 — Remote & server auth](RELEASE.md#020-remote--server-auth) (in planning).

## Product shape

**0.x = reference demo.** The repo shows *enforce + audit* at the MCP `tools/call` boundary: JWT scopes, allow/deny, structured log lines with `session_id` / `trace_id`. The browser chat and audit panel exist to **tell that story in a meeting or PR** — not to replace your ops stack.

**Keep the in-app audit UI simple.** Server section = authoritative security record; Agent attempts = client SDK observability (intent, pre-network denies). Correlate via `trace_id`; no goal to rebuild Grafana in React.

**Production audit (Tier 2+).** Ship the same guard decision JSON to your observability stack (stdout → Loki, OpenTelemetry, Datadog, etc.) and dashboard in **Grafana** or equivalent. The guard stays at the MCP server; only the sink and dashboards change.

---

## Release 0.2.0 — Remote & server auth

Goal: Deploy like production — external MCP URL, HTTPS, scopes enforced on the server so any client (browser, CLI) must present a valid JWT.

| # | Task | Status |
|---|------|--------|
| 1 | Deploy flight MCP to Vercel; document URL (`/mcp`) | Not started |
| 2 | Deploy UI static build to Vercel; set `VITE_MCP_URL` to remote flight URL | Not started |
| 3 | Send `Authorization: Bearer` from `mcp-client.ts` on every MCP request | Done |
| 4 | Enforce JWT + per-tool scopes on flight server | Done |
| 5 | Tighten CORS to UI origin(s) | Not started |
| 6 | README: remote quick start + env vars | In progress |
| 7 | Move completed items from CHANGELOG `[Unreleased]` → `0.2.0` on release | Not started |

**Out of scope for 0.2.0:** IdP login, multi-server agent routing, LangChain, MCP elicitation, real airline APIs.

**Security note:** Browser → remote MCP uses **HTTPS + Bearer JWT scopes** only (no mTLS). See [CONCEPT.md](CONCEPT.md#remote-deployment).

---

## Tier 2 — Product depth (post-0.2.0)

| Item | Notes |
|------|--------|
| IdP integration | Replace `demo-tokens.json` with OAuth/OIDC (Keycloak, Entra, Auth0, etc.) |
| JWKS verification | `ToolGuard` / server loads issuer JWKS instead of demo PEM |
| Multi-server UI | Wire `gateway/config.yaml` slack/github stubs; agent picks `server` + URL |
| Audit export | Persist or download audit log from the demo UI |
| Observability sink | Document/export guard audit JSON (stdout, file, OTel); wire to Grafana/Loki/Datadog |
| Second mock MCP | Prove multi-server policy (optional small `servers/notes/`) |

---

## Tier 3 — Optional

| Item | Notes |
|------|--------|
| LangChain agent service | Python/Node backend; guarded MCP tools |
| MCP elicitation | Server `elicit()` + client callback |
| `@mcp.prompt()` | IDE-style prompt templates |
| MCP CLI / Cursor docs | `mcp.json` example for HTTP flight server |
| UX polish | IATA false positives (`CAN`), empty-search messaging |

---

## How to use this doc

1. Pick a release section or tier item.
2. Open a **new branch** and **PR** ([CONTRIBUTING.md](../CONTRIBUTING.md)).
3. Add bullets under `[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md).
4. Check off tasks here when merged (or move to CHANGELOG on release).

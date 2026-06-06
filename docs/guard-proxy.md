# Guard HTTP proxy (#12)

**Navigation:** [Deploy overview](deploy-overview.md) · [Vercel (flight + UI)](vercel-deploy.md) · [Architecture](ARCHITECTURE.md) · [Next steps](NEXT-STEPS.md)

Authoritative JWT scope enforcement and audit **in front of** upstream MCP URLs you do not control (or your own flight server for local proof).

> **Prod today:** proxy runs locally (`make dev` / `make proxy`) only. Vercel demo is UI → flight direct. See [deploy-overview.md](deploy-overview.md) for paths and the prod deploy checklist.

```
Agent / UI  →  guard proxy (:8787)  →  upstream MCP (vendor or localhost:8000)
                    ↑ gateway/config.yaml + ToolGuard
                    ↑ GET /audit (proxy log)
```

## Local dev

**One terminal:**

```bash
make dev      # flight → proxy → ui
```

Auth0 for flight + proxy: `cp scripts/dev.env.example scripts/dev.env` and export `MCP_JWT_*` there.

**Or three terminals** (`make flight`, `make proxy`, `make ui`) when debugging one hop.

Health: `curl http://localhost:8787/health` — `make stop` frees :8000, :8787, :5173

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | Default server (`MCP_PROXY_DEFAULT_SERVER`, default `flight`) |
| `POST` | `/{serverId}/mcp` | Server from `gateway/config.yaml` |
| `GET` | `/audit` | Proxy enforcement log (`Authorization: Bearer` when guard enabled) |
| `GET` | `/health` | Status + configured server ids |

Non-`tools/call` JSON-RPC (`initialize`, `tools/list`, …) is forwarded without scope checks (same as flight embedded guard).

## Environment

Same JWT trust as flight — export in the **proxy** terminal before `make proxy`:

| Variable | Purpose |
|----------|---------|
| `MCP_PROXY_PORT` | Listen port (default `8787`) |
| `MCP_PROXY_DEFAULT_SERVER` | Server id for `POST /mcp` (default `flight`) |
| `MCP_PROXY_CONFIG` | Optional path to policy yaml (default `gateway/config.yaml`) |
| `MCP_GUARD_PUBLIC_KEY_PEM` | Demo guest JWT verify |
| `MCP_JWT_ISSUER` / `MCP_JWT_AUDIENCE` / `MCP_JWT_JWKS_URL` | Auth0 / IdP dual trust |
| `MCP_GUARD_ENABLED` | `false` bypasses enforcement (dev only) |
| `MCP_CORS_ORIGINS` | Comma-separated origins or `*` |

See [auth0-env.example](auth0-env.example).

## UI without Vite proxy

```bash
# ui/.env.local
VITE_MCP_URL=http://localhost:8787/mcp
```

Audit panel resolves `http://localhost:8787/audit` from that URL.

## Production

**Checklist:** [deploy-overview.md → Prod proxy](deploy-overview.md#prod-proxy-checklist-next-work)

1. Host the proxy on a long-running Node platform (not Vercel serverless) — Fly, Railway, Render, Cloud Run, etc.
2. Set `servers.<id>.url` in `gateway/config.yaml` (or `MCP_PROXY_CONFIG`) to the upstream MCP HTTP endpoint (Vercel flight `/mcp` for the demo, or a vendor URL).
3. Mirror flight JWT env on the proxy (`MCP_GUARD_PUBLIC_KEY_PEM`, `MCP_JWT_*`); set `MCP_CORS_ORIGINS` for the UI origin.
4. Point UI `VITE_MCP_URL` at `https://YOUR-PROXY-HOST/mcp` and redeploy the Vercel UI project.

Agents and the demo UI call **your** proxy URL, not the vendor or flight directly.

Flight embedded guard (`servers/flight/guard_config.yaml`) remains demo scaffolding on Vercel until you optionally disable it; proxy + canonical yaml is the product path for unowned MCP.

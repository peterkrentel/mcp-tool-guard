# Guard HTTP proxy (#12)

**Navigation:** [Deploy overview](deploy-overview.md) · [Vercel (flight + UI)](vercel-deploy.md) · [Architecture](ARCHITECTURE.md) · [Cursor guide](cursor-guide.md) · [Next steps](NEXT-STEPS.md)

Authoritative JWT scope enforcement and audit **in front of** upstream MCP URLs you do not control (or your own flight server for local proof).

> **Prod today:** guard proxy on Render — UI → `mcp-tool-guard-proxy.onrender.com` → Vercel flight. Local: `make dev`. See [deploy-overview.md](deploy-overview.md) and [demo-proxy.md](demo-proxy.md).

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

Auth0 for flight + proxy + agent gateway: `cp scripts/dev.env.example scripts/dev.env` and set `MCP_JWT_*` plus `AUTH0_MGMT_*` (see [auth0-env.example](auth0-env.example)). UI still uses `ui/.env.local` for `VITE_AUTH0_*`.

**Or three terminals** (`make flight`, `make proxy`, `make ui`) when debugging one hop.

Health: `curl http://localhost:8787/health` — `make stop` frees :8000, :8787, :5173

## Routes

### MCP forwarding

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | Default server (`MCP_PROXY_DEFAULT_SERVER`, default `flight`) |
| `POST` | `/{serverId}/mcp` | Server from registry / `gateway/config.yaml` |

Non-`tools/call` JSON-RPC (`initialize`, `tools/list`, …) is forwarded without scope checks (same as flight embedded guard).

**Upstream credentials:** When a server entry sets `upstream_token_env` (e.g. `GITHUB_MCP_TOKEN` for `github`), the proxy sends that Bearer to the vendor MCP. Caller JWT is still used for scope enforcement only — never forwarded as upstream auth when `upstream_token` is configured.

### Agent gateway (stage 1)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/servers` | List registered MCP servers (yaml seed + KV-backed runtime entries) |
| `POST` | `/servers` | Register MCP — **`gateway:admin`** Bearer when `control_plane_auth` (IdP + guard on); persisted to KV when `KV_REST_API_*` set |
| `DELETE` | `/servers/:id` | Remove server — **`gateway:admin`**; KV delete when configured |
| `GET` | `/servers/:id/tools` | Discover tools from upstream (`tools/list`) |
| `GET` | `/agents` | List agents from KV (metadata only; secrets never exposed) |
| `POST` | `/agents` | Create Auth0 M2M client — **`gateway:admin`** + `AUTH0_MGMT_*`; encrypted secret stored in KV when configured |
| `POST` | `/agents/:clientId/token` | Vend agent JWT from server-stored secret — **`gateway:admin`** |
| `DELETE` | `/agents/:clientId` | Revoke M2M client — **`gateway:admin`**; KV delete when configured |
| `POST` | `/token` | Vend `client_credentials` JWT — **`gateway:admin`** |

### Audit + health

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/audit` | All layers — proxy + agent + mcp (`Authorization: Bearer` when guard enabled) |
| `POST` | `/audit/agent` | Append agent-layer entries from browser SDK pre-check |
| `GET` | `/health` | Status, `servers[]`, `kv_enabled`, `control_plane_auth`, `auth0_mgmt_configured` |

## Environment

Same JWT trust as flight — export in the **proxy** terminal before `make proxy`:

| Variable | Purpose |
|----------|---------|
| `MCP_PROXY_PORT` | Listen port (default `8787`; local `make dev`) |
| `PORT` | PaaS listen port when `MCP_PROXY_PORT` unset (Render injects this — do not set `MCP_PROXY_PORT` there) |
| `MCP_PROXY_DEFAULT_SERVER` | Server id for `POST /mcp` (default `flight`) |
| `MCP_PROXY_CONFIG` | Optional path to policy yaml (default `gateway/config.yaml`) |
| `MCP_GUARD_PUBLIC_KEY_PEM` | Demo guest JWT verify |
| `MCP_JWT_ISSUER` / `MCP_JWT_AUDIENCE` / `MCP_JWT_JWKS_URL` | Auth0 / IdP dual trust |
| `MCP_GUARD_ENABLED` | `false` bypasses enforcement and control-plane auth (dev only) |
| `MCP_GATEWAY_ADMIN_AUTH` | `false` disables `gateway:admin` on mutating routes even when guard + IdP trust are on (local override) |
| `MCP_CORS_ORIGINS` | Comma-separated origins or `*` |
| `AUTH0_DOMAIN` | Auth0 tenant (agent gateway — M2M create + token vending) |
| `AUTH0_MGMT_CLIENT_ID` | Machine-to-Machine app with Management API access |
| `AUTH0_MGMT_CLIENT_SECRET` | Mgmt app secret |
| `AUTH0_AUDIENCE` | API identifier for client grants (same as `MCP_JWT_AUDIENCE`) |
| `GITHUB_MCP_TOKEN` | GitHub PAT for `servers.github` upstream auth only — never sent to browsers |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash REST — persist registry + agents (optional locally; same vars as flight) |
| `GATEWAY_KV_PREFIX` | Key namespace (default `mcp-tool-guard:gateway:`) — see [kv-design](kv-design.md#guard-proxy-kv-agent-gateway) |

See [auth0-env.example](auth0-env.example). Prod checklist: [render-deploy.md](render-deploy.md).

## UI without Vite proxy

```bash
# ui/.env.local
VITE_MCP_URL=http://localhost:8787/mcp
```

Audit panel resolves `http://localhost:8787/audit` from that URL.

## Production

**Deployed:** [render-deploy.md](render-deploy.md) · [demo-proxy.md](demo-proxy.md)

1. Host the proxy on a long-running Node platform (not Vercel serverless) — **Render** (live), or Fly, Cloud Run, etc.
2. `gateway/config.prod.yaml` is in the repo — set `MCP_PROXY_CONFIG=config.prod.yaml` on Render so the proxy routes to Vercel flight.
3. Mirror flight JWT env on the proxy (`MCP_GUARD_PUBLIC_KEY_PEM`, `MCP_JWT_*`); set `MCP_CORS_ORIGINS` for the UI origin.
4. Point UI `VITE_MCP_URL` at `https://YOUR-PROXY-HOST/mcp` and redeploy the Vercel UI project.
5. For **[`/agents.html`](../ui/agents.html)** (agent gateway UI): set `VITE_PROXY_BASE_URL` to the proxy origin (no `/mcp` suffix) and redeploy. Flight demo only needs `VITE_MCP_URL`; agents page admin API + per-server MCP paths use `VITE_PROXY_BASE_URL`.

Agents and the demo UI call **your** proxy URL, not the vendor or flight directly.

Flight embedded guard (`servers/flight/guard_config.yaml`) remains demo scaffolding on Vercel until you optionally disable it; proxy + canonical yaml is the product path for unowned MCP.

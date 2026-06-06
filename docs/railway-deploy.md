# Deploy guard proxy to Railway

**Navigation:** [Deploy overview](deploy-overview.md) · [Guard proxy](guard-proxy.md) · [Vercel (flight + UI)](vercel-deploy.md)

Deploy the guard proxy as an always-on Node service on Railway, then rewire the UI to route through it.

---

## Prerequisites

- Proxy code merged to `main` (done — `gateway/proxy-server.ts`)
- Flight MCP live on Vercel (`https://mcp-tool-guard-flight-server.vercel.app/mcp`)
- Auth0 env vars ready (same values used on Vercel flight)
- **Node 22+** — root `package.json` sets `"engines": { "node": ">=22" }` (matches CI). Repo includes `railway.toml` for build/start commands.

---

## Billing and idle behavior

Railway bills by usage (hobby/trial plans have monthly limits). The proxy is a small always-on Node process — fine for a demo, but watch usage in the Railway dashboard.

After idle time, the service may **cold-start** on the next request (first `curl` or UI chat after a gap can be slow). That is normal on constrained plans; not a sign the proxy is misconfigured.

---

## 1. Create a Railway account

Go to [railway.app](https://railway.app) and sign up with GitHub.

---

## 2. New project → Deploy from GitHub repo

1. **New Project** → **Deploy from GitHub repo**
2. Select `peterkrentel/mcp-tool-guard`
3. Railway detects the repo root — leave it there (monorepo, root is correct)
4. **`railway.toml`** at the repo root sets build/start commands and `/health` check — you usually do not need to duplicate them in the dashboard.

---

## 2.5. Generate a public domain

In the Railway service → **Settings** → **Networking** → **Generate Domain**.

Copy the `https://something.up.railway.app` URL — you need it for smoke tests and `VITE_MCP_URL`.

---

## 3. Build and start commands

**Default (from `railway.toml`):**

| Setting | Value |
|---------|-------|
| **Build command** | `npm ci && npm run build -w @mcp-tool-guard/gateway` |
| **Start command** | `npm run start:proxy -w @mcp-tool-guard/gateway` |

Override in Railway → **Settings** → **Deploy** only if you are not using `railway.toml`.

**Node version:** Nixpacks reads `engines.node` from root `package.json` (`>=22`). If the build log shows an older Node, set **Variables** → `NIXPACKS_NODE_VERSION` = `22` (or add it to the service env).

---

## 4. Set environment variables

In the Railway service → **Variables**, add:

| Variable | Value |
|----------|-------|
| `MCP_GUARD_PUBLIC_KEY_PEM` | Contents of `ui/public/demo-public.pem` (paste with real newlines or `\n`) |
| `MCP_JWT_ISSUER` | Your Auth0 issuer, e.g. `https://your-tenant.us.auth0.com/` (trailing slash matters — match what's on Vercel flight) |
| `MCP_JWT_AUDIENCE` | Your Auth0 audience, e.g. `https://mcp-tool-guard` |
| `MCP_JWT_JWKS_URL` | Optional — auto-derived from issuer if not set |
| `MCP_CORS_ORIGINS` | `https://mcp-tool-guard-ui.vercel.app,http://localhost:5173` |
| `MCP_PROXY_DEFAULT_SERVER` | `flight` |
| `MCP_PROXY_CONFIG` | `gateway/config.prod.yaml` |

`PORT` is injected automatically by Railway — do not set `MCP_PROXY_PORT`.

---

## 5. `config.prod.yaml`

`gateway/config.prod.yaml` is already in the repo — it mirrors `config.yaml` with `servers.flight.url` pointing at the Vercel flight deployment. `config.yaml` keeps `localhost:8000` for local dev.

**Slack / GitHub entries are policy stubs only.** `config.prod.yaml` lists `slack` and `github` servers so the yaml stays aligned with `gateway/config.yaml`, but their URLs (`https://mcp.slack.com`, `https://mcp.github.com`) are placeholders — not real MCP endpoints. For this demo, use **`POST /mcp`** (default server `flight`) only. Do not expect `POST /slack/mcp` or `POST /github/mcp` to work.

---

## 6. Deploy and smoke test

Railway auto-deploys on push to `main`. Once the build is green:

```bash
# Health — expect service: mcp-tool-guard-proxy, guard_enabled: true
# servers includes flight + slack + github (stubs); only flight is routable
curl https://YOUR-RAILWAY-DOMAIN/health

# Audit — use a guest JWT from ui/public/demo-tokens.json or an Auth0 access token
curl -H "Authorization: Bearer eyJ..." https://YOUR-RAILWAY-DOMAIN/audit
# → JSON with "source": "guard-proxy"

# Tool call — scope enforced, forwarded to Vercel flight
curl -X POST https://YOUR-RAILWAY-DOMAIN/mcp \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_flights_tool","arguments":{"origin":"JFK","destination":"LAX"}}}'
```

Denied call example (wrong scope):

```bash
curl -X POST https://YOUR-RAILWAY-DOMAIN/mcp \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"cancel_booking_tool","arguments":{"booking_id":"BK-001"}}}'
# → error.code: -32001
```

---

## 7. Rewire the UI

In the Vercel UI project → **Environment Variables**, update:

| Variable | New value |
|----------|-----------|
| `VITE_MCP_URL` | `https://YOUR-RAILWAY-DOMAIN/mcp` |

Redeploy the UI project (rebuild required — Vite bakes `VITE_*` at build time).

### What to expect in the browser after rewire

| Check | Expected |
|-------|----------|
| **DevTools → Network** | `POST` to `https://YOUR-RAILWAY-DOMAIN/mcp` and `GET` to `…/audit` (not `mcp-tool-guard-flight-server.vercel.app`) |
| **Chat** | *Search flights from SFO to JFK* with read scope → tool result in chat |
| **Audit `GET /audit` body** | `"source": "guard-proxy"` in the JSON response |
| **Audit panel header (main UI)** | May still say **Server enforcement** — cosmetic; data is from the proxy |
| **Audit rows** | ALLOW/DENY for tools that reached the proxy; client-only denies still under **Agent attempts** only |
| **Cancel without delete scope** | DENY under **Agent attempts**, no matching proxy row (blocked before network) |

Optional later: merge the **proxy audit UI** branch for path banner + “Proxy enforcement” terminal styling.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails on `npm ci` / TypeScript | Check deploy log for Node version — need **22+** (`engines` in `package.json` or `NIXPACKS_NODE_VERSION=22`) |
| Service crashes on start | `MCP_GUARD_PUBLIC_KEY_PEM` missing or malformed — paste full PEM from `ui/public/demo-public.pem` |
| `ENOENT` / config error on start | `MCP_PROXY_CONFIG` must be `gateway/config.prod.yaml` (path from repo root) |
| `403` / invalid token on `tools/call` | PEM must match `demo-tokens.json`; Auth0 tokens need same `MCP_JWT_*` as Vercel flight |
| Scope deny when token should allow | Compare `permissions` / `scope` on jwt.io with `gateway/config.prod.yaml` `required_scope` |
| CORS error in browser console | Set `MCP_CORS_ORIGINS` to include `https://mcp-tool-guard-ui.vercel.app`; redeploy proxy |
| UI still hits Vercel flight | `VITE_MCP_URL` not updated or UI not **rebuilt** after env change |
| `GET /audit` → 401 | Expected without Bearer — sign in or pick guest token, then **Initialize** |
| Tool call succeeds but empty / error from upstream | Flight Vercel down or `servers.flight.url` wrong in `config.prod.yaml` |
| `POST /slack/mcp` or `/github/mcp` fails | Stubs only — use `POST /mcp` for flight demo |
| First request slow after idle | Railway cold start — retry; normal on hobby usage |
| Health OK but proxy not listening | Do not set `MCP_PROXY_PORT` on Railway — use injected `PORT` only |

---

## Verification checklist

- [ ] `GET /health` → `guard_enabled: true`, `service: mcp-tool-guard-proxy`
- [ ] `servers` lists `flight` (plus `slack` / `github` stubs — **only flight is live**)
- [ ] `POST /mcp` `tools/call` with valid JWT + correct scope → allowed, forwarded to flight
- [ ] `POST /mcp` `tools/call` with missing/wrong scope → `error.code: -32001`
- [ ] `GET /audit` → `"source": "guard-proxy"`
- [ ] UI Network tab shows Railway host for `/mcp` and `/audit`
- [ ] UI chat search/book works end-to-end via proxy

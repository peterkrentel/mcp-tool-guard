# Deploy guard proxy to Render

**Navigation:** [Deploy overview](deploy-overview.md) · [Guard proxy](guard-proxy.md) · [Demo script](demo-proxy.md) · [Vercel (flight + UI)](vercel-deploy.md)

Deploy the guard proxy as a Web Service on [Render](https://render.com), then point the Vercel UI at it.

**Live demo proxy:** [mcp-tool-guard-proxy.onrender.com/health](https://mcp-tool-guard-proxy.onrender.com/health)

---

## Prerequisites

- Proxy code on `main` (`gateway/proxy-server.ts`)
- Flight MCP live on Vercel (`https://mcp-tool-guard-flight-server.vercel.app/mcp`)
- Auth0 env vars ready (same values as Vercel flight)
- **Node 22+** — root `package.json` sets `"engines": { "node": ">=22" }` (matches CI)

---

## Billing and idle behavior

Render **Free** Web Services spin down after ~15 minutes idle. The first request after idle may be slow (cold start) — retry; that is normal, not a misconfiguration.

---

## 1. Create a Render account

Go to [render.com](https://render.com) and sign up with GitHub.

---

## 2. New Web Service → Connect repo

1. **New +** → **Web Service**
2. Connect `peterkrentel/mcp-tool-guard`
3. **Root Directory** — leave empty (repo root; monorepo is correct)
4. **Region** — pick closest to your users
5. **Instance type** — Free (demo) or paid for always-on

---

## 3. Build and start commands

Set these in the Render service **Settings** → **Build & Deploy**:

| Setting | Value |
|---------|-------|
| **Build Command** | `npm ci && npm run build -w @mcp-tool-guard/gateway` |
| **Start Command** | `npm run start:proxy -w @mcp-tool-guard/gateway` |
| **Health Check Path** | `/health` |

**Node version:** Render reads `engines.node` from root `package.json` (`>=22`). If the build log shows an older Node, set env `NODE_VERSION` = `22`.

---

## 4. Public URL

Render assigns a hostname like `https://mcp-tool-guard-proxy.onrender.com`. Use it for smoke tests and `VITE_MCP_URL`.

`PORT` is injected by Render — do **not** set `MCP_PROXY_PORT`.

---

## 5. Environment variables

In the Render service → **Environment**, add:

| Variable | Value |
|----------|-------|
| `MCP_GUARD_PUBLIC_KEY_PEM` | Contents of `ui/public/demo-public.pem` (paste with real newlines or `\n`) |
| `MCP_JWT_ISSUER` | Your Auth0 issuer, e.g. `https://dev-p5fg6ldthdyeom16.us.auth0.com/` (trailing slash must match Vercel flight) |
| `MCP_JWT_AUDIENCE` | Your Auth0 audience, e.g. `https://mcp-tool-guard` |
| `MCP_JWT_JWKS_URL` | Optional — auto-derived from issuer if not set |
| `MCP_CORS_ORIGINS` | `https://mcp-tool-guard-ui.vercel.app,http://localhost:5173` |
| `MCP_PROXY_DEFAULT_SERVER` | `flight` |
| `MCP_PROXY_CONFIG` | `config.prod.yaml` |

**`MCP_PROXY_CONFIG` path:** The start command runs from the `gateway/` workspace package directory. Use `config.prod.yaml` (file lives in `gateway/`). If you see `ENOENT` on start, verify the path relative to the process cwd — do not use `gateway/config.prod.yaml` unless cwd is the repo root.

---

## 6. `config.prod.yaml`

[`gateway/config.prod.yaml`](../gateway/config.prod.yaml) mirrors `config.yaml` with `servers.flight.url` pointing at the Vercel flight deployment. Local dev uses `config.yaml` (`localhost:8000`).

**Slack / GitHub entries are policy stubs only.** Their URLs (`https://mcp.slack.com`, `https://mcp.github.com`) are placeholders — not real MCP endpoints. For this demo, use **`POST /mcp`** (default server `flight`) only.

---

## 7. Deploy and smoke test

Render auto-deploys on push to `main`. Once the build is green:

```bash
PROXY=https://mcp-tool-guard-proxy.onrender.com
TOKEN="<guest JWT from ui/public/demo-tokens.json read_only, or Auth0 access token>"

# Health — expect service: mcp-tool-guard-proxy, guard_enabled: true
curl "$PROXY/health"

# Audit — Bearer required when guard enabled
curl -H "Authorization: Bearer $TOKEN" "$PROXY/audit"
# → JSON with "source": "guard-proxy"

# Tool call — scope enforced, forwarded to Vercel flight
# Accept header is required (curl's default */* breaks SSE forward to flight)
curl -X POST "$PROXY/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_flights_tool","arguments":{"origin":"JFK","destination":"LAX"}}}'
```

Denied call (read-only token + write tool):

```bash
curl -X POST "$PROXY/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_booking_tool","arguments":{"flight_id":"FL505","passenger_name":"Test"}}}'
# → error.code: -32001
# Render logs: [MCPToolGuard] deny create_booking_tool
```

Full demo walkthrough: [demo-proxy.md](demo-proxy.md).

---

## 8. Rewire the UI

In the Vercel UI project → **Environment Variables**, set:

| Variable | Value |
|----------|-------|
| `VITE_MCP_URL` | `https://mcp-tool-guard-proxy.onrender.com/mcp` |

Redeploy the UI project (rebuild required — Vite bakes `VITE_*` at build time).

### What to expect in the browser after rewire

| Check | Expected |
|-------|----------|
| **DevTools → Network** | `POST` to `https://mcp-tool-guard-proxy.onrender.com/mcp` and `GET` to `…/audit` (not `mcp-tool-guard-flight-server.vercel.app`) |
| **Chat** | *Search flights from SFO to JFK* with read scope → tool result in chat |
| **Audit `GET /audit` body** | `"source": "guard-proxy"` in the JSON response |
| **Audit panel header (main UI)** | May still say **Server enforcement** — cosmetic; data is from the proxy |
| **Read-only Auth0 user** | Search → SERVER ALLOW; book → CLIENT DENY (no proxy row) |
| **Admin book + cancel** | Render logs `[MCPToolGuard] allow …`; cancel may log `[MCPToolGuard ALERT]` |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails on `npm ci` / TypeScript | Check deploy log for Node version — need **22+** (`engines` or `NODE_VERSION=22`) |
| Service crashes on start | `MCP_GUARD_PUBLIC_KEY_PEM` missing or malformed — paste full PEM from `ui/public/demo-public.pem` |
| `ENOENT` / config error on start | `MCP_PROXY_CONFIG` = `config.prod.yaml` (cwd is `gateway/` when workspace start runs) |
| `403` / invalid token on `tools/call` | PEM must match `demo-tokens.json`; Auth0 tokens need same `MCP_JWT_*` as Vercel flight |
| Scope deny when token should allow | Compare `permissions` / `scope` on jwt.io with `gateway/config.prod.yaml` `required_scope` |
| CORS error in browser console | Set `MCP_CORS_ORIGINS` to include `https://mcp-tool-guard-ui.vercel.app`; redeploy proxy |
| UI still hits Vercel flight | `VITE_MCP_URL` not updated or UI not **rebuilt** after env change |
| `GET /audit` → 401 | Expected without Bearer — sign in or pick guest token, then **Initialize** |
| Tool call succeeds but empty / error from upstream | Flight Vercel down or `servers.flight.url` wrong in `config.prod.yaml` |
| `POST /slack/mcp` or `/github/mcp` fails | Stubs only — use `POST /mcp` for flight demo |
| First request slow after idle | Render free tier spin-down — retry; normal |
| Health OK but proxy not listening | Do not set `MCP_PROXY_PORT` on Render — use injected `PORT` only |
| curl tool call fails / empty SSE | Add `Accept: application/json, text/event-stream` |

---

## Verification checklist

- [ ] `GET /health` → `guard_enabled: true`, `service: mcp-tool-guard-proxy`
- [ ] `servers` lists `flight` (plus `slack` / `github` stubs — **only flight is live**)
- [ ] `POST /mcp` `tools/call` with valid JWT + correct scope → allowed, forwarded to flight
- [ ] `POST /mcp` `tools/call` with missing/wrong scope → `error.code: -32001`
- [ ] `GET /audit` → `"source": "guard-proxy"`
- [ ] UI Network tab shows Render host for `/mcp` and `/audit`
- [ ] UI chat search/book works end-to-end via proxy

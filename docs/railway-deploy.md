# Deploy guard proxy to Railway

**Navigation:** [Deploy overview](deploy-overview.md) · [Guard proxy](guard-proxy.md) · [Vercel (flight + UI)](vercel-deploy.md)

Deploy the guard proxy as an always-on Node service on Railway, then rewire the UI to route through it.

---

## Prerequisites

- Proxy code merged to `main` (done — `gateway/proxy-server.ts`)
- Flight MCP live on Vercel (`https://mcp-tool-guard-flight-server.vercel.app/mcp`)
- Auth0 env vars ready (same values used on Vercel flight)

---

## 1. Create a Railway account

Go to [railway.app](https://railway.app) and sign up with GitHub.

---

## 2. New project → Deploy from GitHub repo

1. **New Project** → **Deploy from GitHub repo**
2. Select `peterkrentel/mcp-tool-guard`
3. Railway detects the repo root — leave it there (monorepo, root is correct)

---

## 2.5. Generate a public domain

In the Railway service → **Settings** → **Networking** → **Generate Domain**.

Copy the `https://something.up.railway.app` URL — you need it for smoke tests and `VITE_MCP_URL`.

---

## 3. Set build and start commands

In the Railway service settings → **Deploy**:

| Setting | Value |
|---------|-------|
| **Build command** | `npm ci && npm run build -w @mcp-tool-guard/gateway` |
| **Start command** | `npm run start:proxy -w @mcp-tool-guard/gateway` |

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

---

## 6. Deploy and smoke test

Railway auto-deploys on push to `main`. Once the build is green:

```bash
# Health check — expect guard_enabled: true, servers: ["flight", ...]
curl https://YOUR-RAILWAY-DOMAIN/health

# Audit — use a guest JWT from ui/public/demo-tokens.json or an Auth0 access token
curl -H "Authorization: Bearer eyJ..." https://YOUR-RAILWAY-DOMAIN/audit

# Tool call — scope enforced
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

Redeploy the UI project (rebuild required). The audit panel will show `source: guard-proxy` confirming traffic flows through the proxy.

> **Note:** On `main` the audit panel header may still say "Server enforcement" until the proxy audit UI branch is merged. The data is correct; it's cosmetic.

---

## Verification checklist

- [ ] `GET /health` returns `guard_enabled: true` and `servers: ["flight"]`
- [ ] `POST /mcp` `tools/call` with valid JWT + correct scope → allowed, forwarded to flight
- [ ] `POST /mcp` `tools/call` with missing/wrong scope → `error.code: -32001`
- [ ] `GET /audit` returns entries with `source: guard-proxy`
- [ ] UI chat works end-to-end via proxy

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
| `MCP_GUARD_PUBLIC_KEY_PEM` | Contents of `ui/public/demo-public.pem` (inline, `\n` for newlines) |
| `MCP_JWT_ISSUER` | Your Auth0 issuer, e.g. `https://your-tenant.us.auth0.com` |
| `MCP_JWT_AUDIENCE` | Your Auth0 audience, e.g. `https://mcp-tool-guard-api` |
| `MCP_JWT_JWKS_URL` | `https://your-tenant.us.auth0.com/.well-known/jwks.json` |
| `MCP_CORS_ORIGINS` | `https://mcp-tool-guard-ui.vercel.app,http://localhost:5173` |
| `MCP_PROXY_DEFAULT_SERVER` | `flight` |

`PORT` is injected automatically by Railway — the proxy reads it as a fallback.

---

## 5. Point the proxy at Vercel flight

Create `gateway/config.prod.yaml` (copied from `gateway/config.yaml`, one URL changed):

```yaml
servers:
  flight:
    url: https://mcp-tool-guard-flight-server.vercel.app/mcp
    tools:
      # ... same tool config as config.yaml
```

Then add one more Railway variable:

| Variable | Value |
|----------|-------|
| `MCP_PROXY_CONFIG` | `gateway/config.prod.yaml` |

This keeps `config.yaml` pointing at `localhost:8000` for local dev — nothing breaks.

---

## 6. Deploy and smoke test

Railway auto-deploys on push to `main`. Once green:

```bash
# Health check
curl https://YOUR-RAILWAY-URL/health

# Audit (requires Bearer)
curl -H "Authorization: Bearer YOUR_JWT" https://YOUR-RAILWAY-URL/audit

# Tool call (scope enforced)
curl -X POST https://YOUR-RAILWAY-URL/mcp \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_flights_tool","arguments":{"origin":"JFK","destination":"LAX"}}}'
```

`GET /health` should return `guard_enabled: true` and `servers: ["flight"]`.

---

## 7. Rewire the UI

In the Vercel UI project → **Environment Variables**, update:

| Variable | New value |
|----------|-----------|
| `VITE_MCP_URL` | `https://YOUR-RAILWAY-URL/mcp` |

Redeploy the UI project. The audit panel will now show `source: guard-proxy` — confirming traffic flows through the proxy.

---

## Verification checklist

- [ ] `GET /health` returns `guard_enabled: true`
- [ ] `POST /mcp` `tools/call` with valid JWT + correct scope → allowed, forwarded to flight
- [ ] `POST /mcp` `tools/call` with missing/wrong scope → `error.code: -32001`
- [ ] `GET /audit` returns entries with `source: guard-proxy`
- [ ] UI chat works end-to-end via proxy

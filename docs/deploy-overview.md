# Deployment overview

**Navigation:** [Quick start](../README.md) · [Vercel (flight + UI)](vercel-deploy.md) · [Guard proxy](guard-proxy.md) · [Railway deploy](railway-deploy.md) · [Architecture](ARCHITECTURE.md) · [Next steps](NEXT-STEPS.md)

One page for **what runs where** — local dev, Vercel prod today, and the target three-service layout. Step-by-step Vercel setup stays in [vercel-deploy.md](vercel-deploy.md). Proxy routes and env vars: [guard-proxy.md](guard-proxy.md).

---

## Three services

| Service | Repo path | Typical host | Role |
|---------|-----------|--------------|------|
| **Demo UI** | `ui/` | Vercel (static) | WebLLM agent, audit panel, client `ToolGuard` pre-check |
| **Guard HTTP proxy** | `gateway/proxy-server.ts` | **Not Vercel** — Fly, Railway, Render, Cloud Run, etc. | Authoritative enforce + audit on `tools/call`; forwards to upstream MCP |
| **Flight MCP** | `servers/flight/` | Vercel (serverless Python) | Demo upstream MCP; embedded guard is **demo scaffolding** |

Policy for proxy + UI client: [`gateway/config.yaml`](../gateway/config.yaml). Flight embedded copy: [`servers/flight/guard_config.yaml`](../servers/flight/guard_config.yaml) (demo only).

---

## Traffic paths

### Local (`make dev`)

```
Browser → Vite :5173 → Guard proxy :8787 → Flight :8000
              ↑ dev-only proxy        ↑ enforcement + /audit (source: guard-proxy)
```

- Vite dev server proxies `/mcp` and `/audit` to `:8787` ([`ui/vite.config.ts`](../ui/vite.config.ts)).
- JWT env for flight **and** proxy: `scripts/dev.env` (`MCP_JWT_*`), not `ui/.env.local`.
- Details: [README → Quick start](../README.md#quick-start), [guard-proxy.md](guard-proxy.md).

### Vercel prod **today**

```
Browser → Flight Vercel (direct)
              ↑ embedded guard + GET /audit on flight
```

- UI `VITE_MCP_URL` → `https://mcp-tool-guard-flight-server.vercel.app/mcp`.
- **No proxy in this path.** Audit panel shows **Server enforcement** (flight), not `guard-proxy`.
- Setup: [vercel-deploy.md](vercel-deploy.md).

### Vercel prod **target**

```
Browser → Guard proxy (your host) → Flight Vercel
              ↑ authoritative enforce + proxy /audit
```

- Change UI `VITE_MCP_URL` to `https://YOUR-PROXY-HOST/mcp` and redeploy UI.
- Point `gateway/config.yaml` `servers.flight.url` at Vercel flight `/mcp` (not `localhost:8000`).
- Same JWT trust on proxy as flight (`MCP_GUARD_PUBLIC_KEY_PEM`, `MCP_JWT_*`).

---

## Why the proxy is not on Vercel

| | Vercel (flight + UI) | Guard proxy |
|--|----------------------|-------------|
| Runtime | Serverless functions / static assets | Long-running Node `http.createServer` |
| Listen | Per-request invocations | Always-on TCP port |
| Audit today | Flight: KV-backed when linked | In-memory on proxy process |

The proxy is implemented as a persistent Node service ([`gateway/proxy-server.ts`](../gateway/proxy-server.ts)). Deploy it on a platform that runs a web service (Fly.io, Railway, Render, Google Cloud Run with min instances, etc.). Keep flight and UI on Vercel unless you move them later.

---

## What is implemented vs deployed

| Piece | Code on `main` | Deployed to prod |
|-------|----------------|------------------|
| Guard HTTP proxy (#12) | Yes — `make proxy`, `GET /audit` `source: guard-proxy` | **No** — not hosted yet |
| Flight + UI on Vercel | Yes | Yes — [live demo](vercel-deploy.md#live-demo) |
| `make dev` (one terminal) | Yes | N/A (local only) |
| Proxy-focused audit UI | Optional branch / stash | N/A until proxy is prod + UI PR merged |

---

## Prod proxy checklist (next work)

Branch per task; track in [NEXT-STEPS](NEXT-STEPS.md#implementation-backlog-post-030).

1. **Pick a host** for the proxy (Railway or Fly recommended for a small always-on Node service).
2. **Prod upstream URL** — `gateway/config.prod.yaml` already points at Vercel flight. Set `MCP_PROXY_CONFIG=gateway/config.prod.yaml` on the host.
3. **Deploy proxy** — build/start:
   ```bash
   npm ci
   npm run build -w @mcp-tool-guard/gateway
   npm run start:proxy -w @mcp-tool-guard/gateway
   ```
   Listen port: `MCP_PROXY_PORT` locally; `PORT` on Railway/Render when `MCP_PROXY_PORT` is unset. Do not set `MCP_PROXY_PORT` on Railway. See [railway-deploy.md](railway-deploy.md) for full steps.
4. **Env on proxy** — mirror flight: `MCP_GUARD_PUBLIC_KEY_PEM`, `MCP_JWT_*`; `MCP_CORS_ORIGINS` includes `https://mcp-tool-guard-ui.vercel.app`.
5. **Smoke test** — `GET /health`, `GET /audit` with Bearer, one `POST /mcp` `tools/call`.
6. **Rewire UI** — `VITE_MCP_URL=https://YOUR-PROXY-HOST/mcp` on the Vercel UI project; redeploy.
7. **Optional later** — durable proxy audit (KV/Upstash); disable flight embedded guard for proxy-only story; merge proxy audit UI branch.

---

## Audit panel by environment

| Environment | Authoritative `/audit` | UI section title |
|-------------|------------------------|------------------|
| Local `make dev` | Proxy `:8787` (`guard-proxy`) | Proxy enforcement (when proxy audit UI is merged) |
| Vercel today | Flight Vercel | Server enforcement |
| Vercel + deployed proxy | Proxy host | Proxy enforcement (after UI env flip + optional UI PR) |

Client **Agent attempts** and **Agent trace** are always browser-side observability, not authoritative.

---

## Doc map (deploy confusion?)

| Question | Read |
|----------|------|
| What runs where (this page) | **deploy-overview.md** |
| Vercel flight + UI step-by-step | [vercel-deploy.md](vercel-deploy.md) |
| Railway proxy step-by-step | [railway-deploy.md](railway-deploy.md) |
| Proxy routes, local env, `make dev` | [guard-proxy.md](guard-proxy.md) |
| Diagrams, policy, three audit planes | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Task backlog and status | [NEXT-STEPS.md](NEXT-STEPS.md) |
| Auth0 + JWT env | [auth0-setup.md](auth0-setup.md), [identity.md](identity.md) |

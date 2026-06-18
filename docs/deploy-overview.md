# Deployment overview

**Navigation:** [Quick start](../README.md) · [Vercel (flight + UI)](vercel-deploy.md) · [Render (proxy)](render-deploy.md) · [Guard proxy](guard-proxy.md) · [Demo script](demo-proxy.md) · [Cursor guide](cursor-guide.md) · [Architecture](ARCHITECTURE.md) · [Next steps](NEXT-STEPS.md)

One page for **what runs where** — local dev and prod (three services). Step-by-step Vercel setup: [vercel-deploy.md](vercel-deploy.md). Proxy on Render: [render-deploy.md](render-deploy.md). Routes and env: [guard-proxy.md](guard-proxy.md).

---

## Three services

| Service | Repo path | Host (prod) | Role |
|---------|-----------|-------------|------|
| **Demo UI** | `ui/` | Vercel (static) | Flight demo (`index.html`) + agent gateway (`agents.html`); client `ToolGuard` pre-check |
| **Guard HTTP proxy** | `gateway/proxy-server.ts` | **Render** (Web Service) | Authoritative enforce + audit on `tools/call`; forwards to upstream MCP |
| **Flight MCP** | `servers/flight/` | Vercel (serverless Python) | Demo upstream MCP; embedded guard is **demo scaffolding** |

Policy for proxy + UI client: [`gateway/config.yaml`](../gateway/config.yaml). Prod upstream URLs: [`gateway/config.prod.yaml`](../gateway/config.prod.yaml). Flight embedded copy: [`servers/flight/guard_config.yaml`](../servers/flight/guard_config.yaml) (demo only).

---

## Traffic paths

### Local (`make dev`)

```
Browser → Vite :5173 → Guard proxy :8787 → Flight :8000
              ↑ dev-only proxy        ↑ enforcement + /audit (source: guard-proxy)
```

- Vite dev server proxies `/mcp`, `/audit`, `/servers`, `/agents`, `/token` to `:8787` ([`ui/vite.config.ts`](../ui/vite.config.ts)).
- JWT + Auth0 mgmt env for flight **and** proxy: `scripts/dev.env` (`MCP_JWT_*`, `AUTH0_MGMT_*`), not `ui/.env.local`.
- Agents page: `ui/.env.local` with `VITE_AUTH0_*` (browser JWKS for M2M tokens).
- Details: [README → Quick start](../README.md#quick-start), [guard-proxy.md](guard-proxy.md).

### Vercel prod **today**

```
Browser → Render guard proxy → Flight Vercel
              ↑ authoritative enforce + proxy /audit
```

| | URL |
|--|-----|
| UI | [mcp-tool-guard-ui.vercel.app](https://mcp-tool-guard-ui.vercel.app/) |
| Proxy | [mcp-tool-guard-proxy.onrender.com](https://mcp-tool-guard-proxy.onrender.com/health) |
| Flight | [mcp-tool-guard-flight-server.vercel.app](https://mcp-tool-guard-flight-server.vercel.app/health) |

- Flight demo: `VITE_MCP_URL` → `https://mcp-tool-guard-proxy.onrender.com/mcp`.
- Agent gateway: `VITE_PROXY_BASE_URL` → `https://mcp-tool-guard-proxy.onrender.com` (admin API + `/{serverId}/mcp`).
- Render: `AUTH0_MGMT_*` for M2M create + token vending on `/agents.html`.
- Audit panel fetches proxy `/audit` (`source: guard-proxy`). Header may still say **Server enforcement** — cosmetic.
- Deploy steps: [render-deploy.md](render-deploy.md). Live demo script: [demo-proxy.md](demo-proxy.md).

---

## Why the proxy is not on Vercel

| | Vercel (flight + UI) | Guard proxy |
|--|----------------------|-------------|
| Runtime | Serverless functions / static assets | Long-running Node `http.createServer` |
| Listen | Per-request invocations | Always-on TCP port |
| Audit today | Flight: KV-backed when linked | In-memory on proxy process |

The proxy is a persistent Node service ([`gateway/proxy-server.ts`](../gateway/proxy-server.ts)). It runs on Render (or Fly, Cloud Run, etc.). Flight and UI stay on Vercel unless you move them later.

---

## What is implemented vs deployed

| Piece | Code on `main` | Deployed to prod |
|-------|----------------|------------------|
| Guard HTTP proxy (#12) | Yes — `make proxy`, `GET /audit` `source: guard-proxy` | **Yes** — Render |
| Agent gateway stage 1 | Yes — `/agents.html`, registry, M2M, three-layer audit | **Needs env** — `AUTH0_MGMT_*` on Render, `VITE_PROXY_BASE_URL` on Vercel |
| Flight + UI on Vercel | Yes | Yes — [live demo](vercel-deploy.md#live-demo) |
| `make dev` (one terminal) | Yes | N/A (local only) |
| Proxy-focused audit UI | Optional branch / stash | N/A until UI PR merged |
| Agent gateway KV persistence | Yes — when `KV_REST_API_*` set on Render | **Yes** — registry + agents persist |
| External vendor MCP (GitHub + runtime vendors) | Yes — `upstream_token_env` + policy | **Yes** — [track2-github-proof.md](track2-github-proof.md); GitHub in yaml, temporary vendors via `POST /servers` |

---

## Prod proxy (deployed)

Guard proxy is live on Render. Reference:

1. **Host** — [render-deploy.md](render-deploy.md) (build/start, env, smoke tests).
2. **Prod config** — `MCP_PROXY_CONFIG=config.prod.yaml` on Render; file points `servers.flight.url` at Vercel flight.
3. **UI** — `VITE_MCP_URL=https://mcp-tool-guard-proxy.onrender.com/mcp` on Vercel UI project.
4. **Demo** — [demo-proxy.md](demo-proxy.md) (Network tab, read-only deny, Render logs, curl deny).

**Optional later:** durable proxy audit (KV/Upstash); disable flight embedded guard for proxy-only story; merge proxy audit UI branch.

---

## Audit panel by environment

| Environment | Authoritative `/audit` | UI section title |
|-------------|------------------------|------------------|
| Local `make dev` | Proxy `:8787` (`guard-proxy`) | Proxy enforcement (when proxy audit UI is merged) |
| Vercel + Render prod | Render proxy | Server enforcement (cosmetic label; data from proxy) |
| Direct flight (legacy) | Flight Vercel | Server enforcement |

Client **Agent attempts** and **Agent trace** are always browser-side observability, not authoritative.

---

## Doc map (deploy confusion?)

| Question | Read |
|----------|------|
| What runs where (this page) | **deploy-overview.md** |
| Vercel flight + UI step-by-step | [vercel-deploy.md](vercel-deploy.md) |
| Render proxy step-by-step | [render-deploy.md](render-deploy.md) |
| Live demo script (proxy proof) | [demo-proxy.md](demo-proxy.md) |
| Proxy routes, local env, `make dev` | [guard-proxy.md](guard-proxy.md) |
| Diagrams, policy, three audit planes | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Task backlog and status | [NEXT-STEPS.md](NEXT-STEPS.md) |
| Auth0 + JWT env | [auth0-setup.md](auth0-setup.md), [identity.md](identity.md) |

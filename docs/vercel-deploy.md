# Deploy to Vercel (0.3.0)

**Navigation:** [Deploy overview](deploy-overview.md) · [Quick start](../README.md) · [Guard proxy](guard-proxy.md) · [NEXT-STEPS](NEXT-STEPS.md) · [Design (CONCEPT)](CONCEPT.md) · [Roadmap](ROADMAP.md)

Step-by-step guide for hosting the **flight MCP server** and **demo UI** as two separate Vercel projects from this monorepo.

> **Prod today:** **three services** — UI on Vercel, guard proxy on Render, flight on Vercel. UI → `mcp-tool-guard-proxy.onrender.com` → flight. See [deploy-overview.md](deploy-overview.md) and [demo-proxy.md](demo-proxy.md).

## Live demo

| | URL |
|---|-----|
| **UI** | [mcp-tool-guard-ui.vercel.app](https://mcp-tool-guard-ui.vercel.app/) |
| **Guard proxy** | [mcp-tool-guard-proxy.onrender.com/health](https://mcp-tool-guard-proxy.onrender.com/health) |
| **Flight health** | [mcp-tool-guard-flight-server.vercel.app/health](https://mcp-tool-guard-flight-server.vercel.app/health) |
| **MCP endpoint (UI)** | `https://mcp-tool-guard-proxy.onrender.com/mcp` |
| **Server audit (UI)** | `GET https://mcp-tool-guard-proxy.onrender.com/audit` with `Authorization: Bearer` |

Open the UI → **Sign in** (Auth0) or pick a **guest JWT scope** → **Initialize** (WebLLM may take ~1 min first load) → chat.

---

## Overview

| Vercel project | Root directory | What it runs |
|----------------|----------------|--------------|
| **`mcp-tool-guard-flight-server`** | `servers/flight` | Python MCP + JWT guard |
| **`mcp-tool-guard-ui`** | Repository root | Static UI (`ui/dist`) |

Deploy **flight first**, then **proxy** ([render-deploy.md](render-deploy.md)), then **UI** with `VITE_MCP_URL` pointing at the proxy `/mcp`.

---

## Prerequisites

- Vercel account linked to GitHub
- Local smoke test once: `make setup`, `make flight`, `make ui`
- Demo public key: `ui/public/demo-public.pem` (must match `ui/public/demo-tokens.json`)

---

## Part 1 — Flight MCP (Python)

### Project settings

| Setting | Value |
|---------|--------|
| **Root Directory** | `servers/flight` (dashboard only — **not** in `vercel.json`) |
| **Framework** | Python / Other |
| **Install Command** | **Empty** (override on, blank) — Vercel uses **pip** + `requirements.txt`, not `uv` or `npm` |
| **Build Command** | **Empty** |

### `vercel.json` (repo)

Rewrites only — **do not** add a `"functions"` block. That causes an instant build failure:

```text
The pattern "api/index.py" defined in functions doesn't match any Serverless Functions
```

See `servers/flight/vercel.json` in the repo (rewrites for `/mcp`, `/health`, `/audit` → `/api`).

**Max duration (30s):** Vercel → Project → **Settings → Functions** (not `vercel.json`).

### Environment variables

| Variable | Required | Value |
|----------|----------|--------|
| `MCP_GUARD_PUBLIC_KEY_PEM` | **Yes** | Full PEM from `ui/public/demo-public.pem` (guest demo tokens) |
| `MCP_JWT_ISSUER` | For Auth0 | `https://YOUR_TENANT.us.auth0.com/` |
| `MCP_JWT_AUDIENCE` | For Auth0 | `https://mcp-tool-guard` |
| `MCP_JWT_JWKS_URL` | Optional | Derived from issuer if omitted |
| `MCP_GUARD_ENABLED` | No | `true` (default). `false` logs a loud warning and disables enforcement |

Set on **Production**, **Preview**, and **Development**. Redeploy after adding env vars.

**Dual trust:** keep **`MCP_GUARD_PUBLIC_KEY_PEM`** for guest JWTs **and** set `MCP_JWT_*` for Auth0 — see [identity.md](identity.md).

The flight project root is only `servers/flight/` — it cannot read `ui/public/` from disk on Vercel.

### Verify

```bash
curl https://mcp-tool-guard-flight-server.vercel.app/health
```

Expected: `"status":"healthy"`, `"guard_enabled":true`. With Auth0 env: `"jwt_trust_enabled":true`. With Vercel KV linked: `"kv_enabled":true`.

| URL | Browser GET | Meaning |
|-----|-------------|---------|
| `/health` | JSON | Server OK |
| `/audit` | **401** without Bearer | Protected when guard enabled — use UI or `curl -H "Authorization: Bearer …"` |
| `/mcp` | **Method Not Allowed** | **Normal** — MCP expects POST, not browser GET |

### Serverless notes

- Cold starts after idle
- Without KV: audit + bookings are in-memory per instance (demo only)
- With KV: audit and bookings persist across invocations — see below

---

## Vercel KV (Phase B) {#vercel-kv-phase-b}

Fixes **empty server audit panel** and **cancel booking not found** when MCP and `/audit` hit different serverless instances.

1. Vercel dashboard → **Storage** → **Create Database** → **KV**
2. **Connect** the store to project **`mcp-tool-guard-flight-server`** (Production + Preview)
3. Redeploy flight — Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` (do not copy manually unless needed)
4. Verify: `curl …/health` → `"kv_enabled":true`

| Variable | Required | Purpose |
|----------|----------|---------|
| `KV_REST_API_URL` | Auto (linked store) | Upstash REST endpoint |
| `KV_REST_API_TOKEN` | Auto (linked store) | REST auth |
| `MCP_KV_PREFIX` | No | Key prefix (default `mcp-tool-guard:`) |

Key layout: [kv-design.md](kv-design.md) — `audit:recent`, `audit:session:{id}`, `booking:{BK-…}`.

Local dev works without KV (in-memory fallback). No UI env changes.

---

## Part 2 — Demo UI (Vite + WebLLM)

### Project settings

| Setting | Value |
|---------|--------|
| **Root Directory** | *(empty — repo root)* |
| **Install Command** | `npm ci` |
| **Build Command** | `npm run build -w @mcp-tool-guard/gateway && npm run build -w ui` |
| **Output Directory** | `ui/dist` |

Do **not** use `npm install --prefix=..` (that was for a misconfigured Python project, not the UI).

### Environment variables

| Variable | Required | Value |
|----------|----------|--------|
| `VITE_MCP_URL` | **Yes** | `https://mcp-tool-guard-proxy.onrender.com/mcp` (prod — via guard proxy). Flight direct (legacy): `https://mcp-tool-guard-flight-server.vercel.app/mcp` |
| `VITE_AUTH0_DOMAIN` | For Auth0 login | `YOUR_TENANT.us.auth0.com` |
| `VITE_AUTH0_CLIENT_ID` | For Auth0 login | SPA client id from Auth0 dashboard |
| `VITE_AUTH0_AUDIENCE` | For Auth0 login | `https://mcp-tool-guard` |
| `VITE_ENABLE_GUEST_DEMO` | No | `true` (default) — show guest JWT dropdown alongside Auth0 |

Set **before** build — Vite bakes `VITE_*` in. Redeploy UI after env changes.

Copy full template: [auth0-env.example](auth0-env.example). Dashboard steps: [auth0-setup.md](auth0-setup.md).

### JWT tokens

**Guest (default):** static files — no token env vars:

- `/demo-tokens.json` — JWT dropdown (`read_only`, `booking`, `admin`)
- `/demo-public.pem` — client `ToolGuard` verify

**Auth0:** Sign in button when `VITE_AUTH0_*` set. Access token sent as Bearer on MCP + `/audit`.

Flight must trust **both** paths: `MCP_GUARD_PUBLIC_KEY_PEM` (guest) + `MCP_JWT_*` (Auth0).

### Browser smoke test

1. [Open the UI](https://mcp-tool-guard-ui.vercel.app/)
2. **Initialize** → wait for WebLLM
3. *Search flights from SFO to JFK* (read-only)
4. *Cancel booking BK-…* with same token → deny in audit panels

---

## Part 3 — CORS (0.2.0+)

Flight server defaults to these origins (no env var required):

- `https://mcp-tool-guard-ui.vercel.app`
- `http://localhost:5173`, `http://127.0.0.1:5173` (local `make ui`)

Optional flight env:

| Variable | Example | Purpose |
|----------|---------|---------|
| `MCP_CORS_ORIGINS` | `https://my-ui.example.com,http://localhost:5173` | Extra or replacement origins (comma-separated) |
| `MCP_CORS_ORIGINS` | `*` | Open CORS (not recommended on public deploy) |

**Redeploy flight** after changing CORS. If the UI shows CORS errors in the browser console, add your UI origin here.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Instant “unmatched function pattern” on build | Remove `"functions"` from `servers/flight/vercel.json` |
| `npm install --prefix=..` in flight logs | Clear Install Command on flight project |
| 403 on tools | `MCP_GUARD_PUBLIC_KEY_PEM` must match `demo-tokens.json` signing key |
| UI can't reach MCP | Set `VITE_MCP_URL`, redeploy UI |
| GET `/mcp` → Method Not Allowed | Expected — use `/health` or the UI |
| Server enforcement panel empty but tools work | Link Vercel KV to flight + redeploy; check `/health` → `kv_enabled: true` |
| `/audit` returns 401 in browser | Expected — authenticated endpoint since 0.3 |
| CORS error from UI to flight | Redeploy flight; set `MCP_CORS_ORIGINS` to include your UI origin |

---

## 0.3.0 checklist

- [x] Flight: `MCP_GUARD_PUBLIC_KEY_PEM` + `MCP_JWT_*` (Auth0)
- [x] UI: `VITE_MCP_URL` + `VITE_AUTH0_*`
- [x] Auth0 SPA callbacks include UI origin + `http://localhost:5173`
- [x] Smoke: guest scope deny + Auth0 login + `/audit` with Bearer
- [x] Flight: Vercel KV linked → `/health` → `kv_enabled: true`
- [x] Tag `v0.3.0` on `main` per [RELEASE.md](RELEASE.md)

## 0.2.0 checklist (done)

- [x] Flight deployed; `/health` returns `guard_enabled: true`
- [x] `MCP_GUARD_PUBLIC_KEY_PEM` on flight project
- [x] UI deployed with `VITE_MCP_URL`
- [x] Live demo smoke test
- [x] CORS restricted to UI + local Vite (redeploy flight after merge)
- [x] Tag `v0.2.0` on `main` per [RELEASE.md](RELEASE.md)

---

## Related

- [deploy-overview.md](deploy-overview.md) — **start here** if local proxy vs Vercel prod is confusing
- [guard-proxy.md](guard-proxy.md) — proxy routes, env, local `make dev`
- [README → Deploy](../README.md#deploy)
- [NEXT-STEPS](NEXT-STEPS.md) — backlog (proxy deploy to prod is next)
- [CONCEPT → Remote deployment](CONCEPT.md#remote-deployment)
- Local deps: `uv export --directory servers/flight --no-hashes -o servers/flight/requirements.txt`

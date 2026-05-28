# Deploy to Vercel (0.2.0)

**Navigation:** [Quick start](../README.md) · [Design (CONCEPT)](CONCEPT.md) · [Roadmap](ROADMAP.md)

Step-by-step guide for hosting the **flight MCP server** and **demo UI** as two separate Vercel projects from this monorepo.

## Overview

| Project | Vercel root directory | Public URLs |
|---------|----------------------|-------------|
| **Flight MCP** | `servers/flight` | `/mcp`, `/health`, `/audit` |
| **Demo UI** | Repository root | Static app (`ui/dist`) |

The UI must be built with `VITE_MCP_URL` pointing at the deployed flight `/mcp` endpoint. Deploy **flight first**, then **UI**.

## Prerequisites

- Vercel account linked to GitHub (or [Vercel CLI](https://vercel.com/docs/cli))
- Repo on `main`; local smoke test: `make setup`, `make flight`, `make ui`
- Demo JWT public key: `ui/public/demo-public.pem` (must match `ui/public/demo-tokens.json`)

---

## Part 1 — Flight MCP (Python)

### 1. Create project

1. Vercel → **Add New** → **Project** → import `mcp-tool-guard`
2. **Root Directory:** `servers/flight`
3. Framework should detect Python via `api/index.py` and `vercel.json`

### 2. How routing works

`servers/flight/vercel.json` rewrites:

- `/mcp` → `api/index.py` (MCP over HTTP/SSE)
- `/health` → health JSON
- `/audit` → server enforcement log (in-memory)

`api/index.py` mounts the ASGI app at `/` inside the serverless function.

### 3. Environment variables

| Variable | Required | Value |
|----------|----------|--------|
| `MCP_GUARD_PUBLIC_KEY_PEM` | **Yes** on Vercel | Full PEM from `ui/public/demo-public.pem` (include `-----BEGIN/END-----` lines). Newlines in the dashboard are fine. |
| `MCP_GUARD_ENABLED` | No | `true` (default). Set `false` only for debugging. |

**Why the env var is required:** The flight project root is only `servers/flight/`. Files under `ui/public/` are not deployed with that project, so the server cannot load the PEM from disk unless you set `MCP_GUARD_PUBLIC_KEY_PEM`.

The PEM must be the public half of the key that signed `demo-tokens.json` (use the committed `demo-public.pem` from the repo).

### 4. Deploy

Deploy from the dashboard or:

```bash
cd servers/flight
vercel link          # first time: create/link project
vercel env add MCP_GUARD_PUBLIC_KEY_PEM production   # paste PEM when prompted
vercel --prod
```

Save the production URL, e.g. `https://your-flight.vercel.app`.

### 5. Verify

```bash
curl https://your-flight.vercel.app/health
curl https://your-flight.vercel.app/audit
```

Expected on `/health`: `"status": "healthy"`, `"guard_enabled": true`.

If you see a JWT public key error at deploy or import time, fix `MCP_GUARD_PUBLIC_KEY_PEM`.

### Serverless notes

- **Cold starts** on first request after idle
- **Max duration** 30s (`vercel.json` → `functions.api/index.py.maxDuration`)
- **Audit log** is in-memory per instance; it resets on cold start — OK for demo, not for compliance

---

## Part 2 — Demo UI (Vite + WebLLM)

The UI depends on the monorepo workspace (`@mcp-tool-guard/gateway`). Deploy from the **repository root**, not `ui/` alone.

### 1. Create second project

1. Vercel → **Add New** → **Project** → same GitHub repo
2. **Root Directory:** leave empty (repo root)

### 2. Build settings

| Setting | Value |
|---------|--------|
| **Framework Preset** | Vite (or Other) |
| **Build Command** | `npm ci && npm run build -w @mcp-tool-guard/gateway && npm run build -w ui` |
| **Output Directory** | `ui/dist` |
| **Install Command** | `npm ci` (optional if build already runs `npm ci`) |

### 3. Environment variable

| Variable | Required | Value |
|----------|----------|--------|
| `VITE_MCP_URL` | **Yes** | `https://your-flight.vercel.app/mcp` (use your flight URL; include `/mcp`) |

Set this **before** the build. Vite embeds it at compile time. If you change the flight URL, **redeploy the UI**.

### 4. Deploy

```bash
# From repository root
vercel link          # second project
vercel env add VITE_MCP_URL production
# Enter: https://your-flight.vercel.app/mcp
vercel --prod
```

### 5. Browser smoke test

1. Open the UI production URL
2. **JWT scope** → e.g. Read only → **Initialize** (WebLLM download may take a minute)
3. *"Search flights from SFO to JFK"* — should call remote MCP
4. Same token → *"Cancel booking BK-…"* — expect deny in chat and audit
5. **Audit panel:** Server enforcement rows after real `tools/call`; Agent attempts for client-side denies

If MCP fails, check the browser **Network** tab for requests to your flight host (403, CORS, 5xx).

---

## Part 3 — CORS (optional, roadmap task 5)

Flight currently uses `allow_origins=["*"]` in `server.py`, which is enough for the first deploy.

Later, restrict to your UI origin, e.g. `https://your-ui.vercel.app`, in `CORSMiddleware` and redeploy flight.

---

## Part 4 — CLI quick reference

```bash
# Flight (servers/flight)
cd servers/flight && vercel --prod

# UI (repo root)
cd /path/to/mcp-tool-guard && vercel --prod
```

Configure build/output in the dashboard if the CLI does not infer monorepo settings.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Deploy / import crash on flight | Missing `MCP_GUARD_PUBLIC_KEY_PEM` |
| 403 on all tools | PEM does not match `demo-tokens.json` signing key |
| UI never reaches MCP | Wrong or missing `VITE_MCP_URL`; UI built before env was set → redeploy UI |
| UI build fails | Root set to `ui/` only — use **repo root** and build gateway + ui |
| Empty server audit after success | New serverless instance / cold start |
| MCP / SSE errors | Check Vercel function logs; serverless streaming limits |

---

## 0.2.0 checklist

- [ ] Flight deployed; `/health` returns `guard_enabled: true`
- [ ] `MCP_GUARD_PUBLIC_KEY_PEM` set on flight project
- [ ] UI deployed with `VITE_MCP_URL`
- [ ] Initialize + search + scope denial smoke test
- [ ] (Optional) Tighten CORS to UI origin
- [ ] On release: update [CHANGELOG](../CHANGELOG.md) and tag per [RELEASE.md](RELEASE.md)

---

## Related

- Env var summary: [README → Deploy](../README.md#deploy)
- Design / trust boundaries: [CONCEPT → Remote deployment](CONCEPT.md#remote-deployment)
- Release tasks: [ROADMAP → 0.2.0](ROADMAP.md#release-020--remote--server-auth)

After changing `pyproject.toml` for flight, regenerate deps:

```bash
uv export --directory servers/flight --no-hashes -o servers/flight/requirements.txt
```

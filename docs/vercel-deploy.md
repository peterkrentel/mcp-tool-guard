# Deploy to Vercel (0.2.0)

**Navigation:** [Quick start](../README.md) · [NEXT-STEPS](NEXT-STEPS.md) · [Design (CONCEPT)](CONCEPT.md) · [Roadmap](ROADMAP.md)

Step-by-step guide for hosting the **flight MCP server** and **demo UI** as two separate Vercel projects from this monorepo.

## Live demo

| | URL |
|---|-----|
| **UI** | [mcp-tool-guard-ui.vercel.app](https://mcp-tool-guard-ui.vercel.app/) |
| **Flight health** | [mcp-tool-guard-flight-server.vercel.app/health](https://mcp-tool-guard-flight-server.vercel.app/health) |
| **MCP endpoint** | `https://mcp-tool-guard-flight-server.vercel.app/mcp` |
| **Server audit** | [mcp-tool-guard-flight-server.vercel.app/audit](https://mcp-tool-guard-flight-server.vercel.app/audit) |

Open the UI → pick a **JWT scope** → **Initialize** (WebLLM may take ~1 min first load) → chat.

---

## Overview

| Vercel project | Root directory | What it runs |
|----------------|----------------|--------------|
| **`mcp-tool-guard-flight-server`** | `servers/flight` | Python MCP + JWT guard |
| **`mcp-tool-guard-ui`** | Repository root | Static UI (`ui/dist`) |

Deploy **flight first**, then **UI** with `VITE_MCP_URL` pointing at flight `/mcp`.

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
| `MCP_GUARD_PUBLIC_KEY_PEM` | **Yes** | Full PEM from `ui/public/demo-public.pem` |
| `MCP_GUARD_ENABLED` | No | `true` (default) |

Set on **Production**, **Preview**, and **Development**. Redeploy after adding env vars.

The flight project root is only `servers/flight/` — it cannot read `ui/public/` from disk on Vercel.

### Verify

```bash
curl https://mcp-tool-guard-flight-server.vercel.app/health
```

Expected: `"status":"healthy"`, `"guard_enabled":true`.

| URL | Browser GET | Meaning |
|-----|-------------|---------|
| `/health` | JSON | Server OK |
| `/audit` | JSON | Server audit log |
| `/mcp` | **Method Not Allowed** | **Normal** — MCP expects POST, not browser GET |

### Serverless notes

- Cold starts after idle
- Audit log is in-memory; resets on cold start (demo only)

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

### Environment variable

| Variable | Required | Value |
|----------|----------|--------|
| `VITE_MCP_URL` | **Yes** | `https://mcp-tool-guard-flight-server.vercel.app/mcp` |

Set **before** build — Vite bakes it in. Redeploy UI if the flight URL changes.

### JWT tokens (no UI env vars)

The UI loads demo assets from static files (shipped in the build):

- `/demo-tokens.json` — JWT dropdown (`read_only`, `booking`, `admin`)
- `/demo-public.pem` — client `ToolGuard` verify

No `VITE_*` token variables. Flight server **`MCP_GUARD_PUBLIC_KEY_PEM`** must be the matching public key.

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
| Server enforcement panel empty but tools work | Serverless: MCP and `/audit` may hit different instances; see [NEXT-STEPS](NEXT-STEPS.md) (0.3 KV) |
| CORS error from UI to flight | Redeploy flight; set `MCP_CORS_ORIGINS` to include your UI origin |

---

## 0.2.0 checklist

- [x] Flight deployed; `/health` returns `guard_enabled: true`
- [x] `MCP_GUARD_PUBLIC_KEY_PEM` on flight project
- [x] UI deployed with `VITE_MCP_URL`
- [x] Live demo smoke test
- [x] CORS restricted to UI + local Vite (redeploy flight after merge)
- [x] Tag `v0.2.0` on `main` per [RELEASE.md](RELEASE.md)

---

## Related

- [README → Deploy](../README.md#deploy)
- [NEXT-STEPS](NEXT-STEPS.md) — redeploy, tag, 0.3 backlog
- [CONCEPT → Remote deployment](CONCEPT.md#remote-deployment)
- Local deps: `uv export --directory servers/flight --no-hashes -o servers/flight/requirements.txt`

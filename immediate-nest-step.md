# Immediate next step

Follow the full walkthrough: **[docs/auth0-setup.md](docs/auth0-setup.md)** (dashboard → local → Vercel → token verify).

Permissions + Auth0 walkthrough docs are on **`main`** (PR #14 merged).

## Quick checklist

### Local (validated)

1. [auth0-setup.md → Part 1](docs/auth0-setup.md#part-1--auth0-dashboard) — API, RBAC, SPA, user permissions
2. **`ui/.env.local`** — `VITE_*` only ([auth0-env.example](docs/auth0-env.example))
3. **`export MCP_JWT_*`** in the flight terminal → `make flight` (not in `.env.local`)
4. `make ui` → Sign in → Initialize → search → book → **Cancel booking BK-…**
5. `curl http://localhost:8000/health` → `jwt_trust_enabled: true`

### Vercel (next)

1. Flight env: `MCP_GUARD_PUBLIC_KEY_PEM` + `MCP_JWT_*` — [vercel-deploy.md](docs/vercel-deploy.md)
2. UI env: `VITE_MCP_URL` + `VITE_AUTH0_*` → redeploy (rebuild)
3. Prod smoke: Sign in + guest on [mcp-tool-guard-ui.vercel.app](https://mcp-tool-guard-ui.vercel.app/)
4. Tag `v0.3.0` when happy — [RELEASE.md](docs/RELEASE.md)

### Screenshots (optional)

PNG filenames: [docs/images/auth0/README.md](docs/images/auth0/README.md)

### Next backlog

Phase B: Vercel KV for durable server audit + booking persistence — [NEXT-STEPS.md](docs/NEXT-STEPS.md).

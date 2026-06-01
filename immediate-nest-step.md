# Immediate next step — 0.3.0 deploy

Phase A code is on `main`: Auth0 login + guest demo, dual JWT trust, `/audit` Bearer auth.

## 1. Auth0 dashboard

Finish [docs/auth0-setup.md](docs/auth0-setup.md):

- API `https://mcp-tool-guard` with `flights:read`, `flights:write`, `flights:delete`
- SPA callbacks: `https://mcp-tool-guard-ui.vercel.app`, `http://localhost:5173`
- API Access → enable user-delegated permissions for the SPA

## 2. Vercel env — flight project

| Variable | Value |
|----------|--------|
| `MCP_GUARD_PUBLIC_KEY_PEM` | (keep — guest demo) |
| `MCP_JWT_ISSUER` | `https://YOUR_TENANT.us.auth0.com/` |
| `MCP_JWT_AUDIENCE` | `https://mcp-tool-guard` |

Redeploy flight.

## 3. Vercel env — UI project

| Variable | Value |
|----------|--------|
| `VITE_MCP_URL` | `https://mcp-tool-guard-flight-server.vercel.app/mcp` |
| `VITE_AUTH0_DOMAIN` | your tenant |
| `VITE_AUTH0_CLIENT_ID` | SPA client id |
| `VITE_AUTH0_AUDIENCE` | `https://mcp-tool-guard` |

Redeploy UI (rebuild required).

## 4. Smoke test

- Guest: scope dropdown → Initialize → search → cancel (deny)
- Auth0: Sign in → Initialize → same flows with IdP token
- Server audit panel loads (no red error banner)

## 5. Tag

When happy: `git tag v0.3.0` on `main` per [docs/RELEASE.md](docs/RELEASE.md).

## Next backlog

Phase B: Vercel KV for durable server audit — [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md).

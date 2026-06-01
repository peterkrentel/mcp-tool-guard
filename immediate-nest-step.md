# Immediate next step

Follow the full walkthrough: **[docs/auth0-setup.md](docs/auth0-setup.md)** (dashboard → local → Vercel → token verify).

## Quick checklist

### Local (do first)

1. [auth0-setup.md → Part 1](docs/auth0-setup.md#part-1--auth0-dashboard) — API, RBAC, SPA, user permissions
2. `ui/.env.local` from [auth0-env.example](docs/auth0-env.example)
3. `export MCP_JWT_ISSUER=…` + `export MCP_JWT_AUDIENCE=…` → `make flight`
4. `make ui` → Sign in → Initialize → smoke test
5. Merge [permissions claim PR](https://github.com/peterkrentel/mcp-tool-guard/pull/new/fix/auth0-permissions-claim) if not on `main` yet

### Vercel (after local works)

1. Flight env: `MCP_GUARD_PUBLIC_KEY_PEM` + `MCP_JWT_*` — [vercel-deploy.md](docs/vercel-deploy.md)
2. UI env: `VITE_MCP_URL` + `VITE_AUTH0_*` → redeploy (rebuild)
3. Tag `v0.3.0` when happy — [RELEASE.md](docs/RELEASE.md)

### Screenshots for docs

Capture PNGs listed in [docs/images/auth0/README.md](docs/images/auth0/README.md) and commit to `docs/images/auth0/` so [auth0-setup.md](docs/auth0-setup.md) renders them on GitHub.

### Next backlog

Phase B: Vercel KV for durable server audit — [NEXT-STEPS.md](docs/NEXT-STEPS.md).

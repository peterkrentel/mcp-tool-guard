# Immediate next step

**Phase B (KV)** code is on branch `feature/vercel-kv-phase-b`. Deploy steps below.

## Deploy KV (flight project)

1. [vercel-deploy.md → Vercel KV](docs/vercel-deploy.md#vercel-kv-phase-b) — create KV, connect to **`mcp-tool-guard-flight-server`**, redeploy
2. `curl https://mcp-tool-guard-flight-server.vercel.app/health` → `"kv_enabled": true`
3. Prod smoke: book → **Cancel booking BK-…** → server audit rows persist; cancel finds booking

## After merge

1. Tag **`v0.3.0`** — [RELEASE.md](docs/RELEASE.md)
2. Phase C: ROADMAP #7–10 — [NEXT-STEPS.md](docs/NEXT-STEPS.md)

## Reference

- [kv-design.md](docs/kv-design.md) — key schema
- [auth0-setup.md](docs/auth0-setup.md) — Auth0 (live on prod)

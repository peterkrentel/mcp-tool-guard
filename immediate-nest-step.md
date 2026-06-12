# Immediate next step

**Released:** [CHANGELOG 0.3.1](CHANGELOG.md#031---2026-06-02) — WebLLM heuristics (#11), read-only scope demo screenshots.

Prior: [CHANGELOG 0.3.0](CHANGELOG.md#030---2026-06-02) — Auth0 + guest dual trust, Vercel KV audit/bookings.

**Prod:** Guard proxy live on Render — UI → `mcp-tool-guard-proxy.onrender.com` → Vercel flight.

## Implementation backlog (ordered)

See **[NEXT-STEPS → Implementation backlog](docs/NEXT-STEPS.md#implementation-backlog-post-030)**.

**Next:** **Track 3 approval queue** — [cursor-guide Track 3](docs/cursor-guide.md#track-3--approval-queue-on-demand-scope). **Done:** GitHub MCP — [track2-github-proof.md](docs/track2-github-proof.md).

**Deferred:** **#9/#10** multi-server + second mock MCP (branch `feature/documents-multi-server` closed without merge).

Optional anytime: **#7** max body (hardening). Policy **#8**, Agent trace, guard proxy (#12), Render deploy, demo docs — done on `main`.

## Reference

- [deploy-overview.md](docs/deploy-overview.md) — what runs where (local vs prod)
- [render-deploy.md](docs/render-deploy.md) — guard proxy on Render
- [demo-proxy.md](docs/demo-proxy.md) — live demo script (Network, logs, curl deny)
- [kv-design.md](docs/kv-design.md) — KV keys (`KEYS mcp-tool-guard:booking:*` in Upstash REPL)
- [auth0-setup.md](docs/auth0-setup.md) — Auth0 + local/prod env
- [vercel-deploy.md](docs/vercel-deploy.md) — flight + UI + KV
- [images/demo/README.md](docs/images/demo/README.md) — prod UI + jwt.io screenshots

# Immediate next step

**Released:** [CHANGELOG 0.3.1](CHANGELOG.md#031---2026-06-02) — WebLLM heuristics (#11), read-only scope demo screenshots.

Prior: [CHANGELOG 0.3.0](CHANGELOG.md#030---2026-06-02) — Auth0 + guest dual trust, Vercel KV audit/bookings.

## Implementation backlog (ordered)

See **[NEXT-STEPS → Implementation backlog](docs/NEXT-STEPS.md#implementation-backlog-post-030)**.

**Next PR:** **#12** guard HTTP proxy — enforce + audit in front of vendor/customer MCP (product path; we do not host MCP).

**Deferred:** **#9/#10** multi-server + second mock MCP (branch `feature/documents-multi-server` closed without merge).

Optional anytime: **#7** max body (hardening). Policy **#8**, Agent trace, ARCHITECTURE — done on `main`.

## Reference

- [kv-design.md](docs/kv-design.md) — KV keys (`KEYS mcp-tool-guard:booking:*` in Upstash REPL)
- [auth0-setup.md](docs/auth0-setup.md) — Auth0 + local/prod env
- [vercel-deploy.md](docs/vercel-deploy.md) — flight + UI + KV
- [images/demo/README.md](docs/images/demo/README.md) — prod UI + jwt.io screenshots

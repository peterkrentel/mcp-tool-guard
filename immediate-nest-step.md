# Immediate next step

**Released:** [v0.3.0](https://github.com/peterkrentel/mcp-tool-guard/releases/tag/v0.3.0) — Auth0 + guest dual trust, Vercel KV audit/bookings.

**On `main` (Unreleased in CHANGELOG):** WebLLM heuristics (#11, PR #22), read-only Auth0 demo screenshots, prod scope-deny smoke verified.

## Implementation backlog (pick one PR)

See **[NEXT-STEPS → Implementation backlog](docs/NEXT-STEPS.md#implementation-backlog-post-030)** (ROADMAP #7–10, #12).

**Suggested first PR:** Single policy source + CI drift (**#8**).

## Reference

- [kv-design.md](docs/kv-design.md) — KV keys (`KEYS mcp-tool-guard:booking:*` in Upstash REPL)
- [auth0-setup.md](docs/auth0-setup.md) — Auth0 + local/prod env
- [vercel-deploy.md](docs/vercel-deploy.md) — flight + UI + KV
- [images/demo/README.md](docs/images/demo/README.md) — prod UI + jwt.io screenshots

# Release process

All changes land via **pull request**; releases are tagged from `main` after CHANGELOG and version are updated.

## Workflow (every change)

1. `git checkout main && git pull`
2. `git checkout -b feature/<short-name>` (or `fix/`, `docs/`, `release/`)
3. Implement; update **[CHANGELOG.md](../CHANGELOG.md)** under `[Unreleased]`
4. If roadmap work: check off or note in **[ROADMAP.md](ROADMAP.md)**
5. `npm run typecheck` (and test locally: `make flight` + `make ui`)
6. Open PR → review → merge to `main`
7. Do **not** push directly to `main` (enable branch protection on GitHub when ready)

CI requires **CHANGELOG.md** to be updated on PRs to `main` (see `.github/workflows/changelog.yml`).

---

## Versioning

- [Semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`
- Version lives in root **`package.json`** (`version` field)
- Git tags: `v0.2.0`, `v0.2.1`, …

| Bump | When |
|------|------|
| MAJOR | Breaking guard API, config schema, or demo token shape |
| MINOR | New features (server auth, deploy, multi-server) |
| PATCH | Fixes, docs-only, deps |

---

## Cutting a release

Example: ship **0.2.0** after [ROADMAP 0.2.0](ROADMAP.md#release-020--remote--server-auth) tasks are done.

1. Branch: `release/0.2.0`
2. In **CHANGELOG.md**: rename `[Unreleased]` → `## [0.2.0] - YYYY-MM-DD`, add fresh empty `[Unreleased]`
3. Set `"version": "0.2.0"` in root, `gateway`, and `ui` `package.json`
4. PR → merge `main`
5. **Redeploy flight** on Vercel (CORS and any server changes)
6. Tag and push:
   ```bash
   git checkout main && git pull
   git tag -a v0.2.0 -m "v0.2.0: Remote deploy and server-side JWT"
   git push origin v0.2.0
   ```
7. Create **GitHub Release** from tag; paste CHANGELOG section for 0.2.0
8. Follow [NEXT-STEPS.md](NEXT-STEPS.md) for 0.3.0 work

---

## 0.1.0 {#010}

Initial demo: FastMCP flight server, browser UI (WebLLM), `ToolGuard` SDK, server + client audit panels, demo JWTs.

---

## 0.2.0 — Remote & server auth {#020-remote--server-auth}

Shipped **2026-05-25** (see [CHANGELOG 0.2.0](../CHANGELOG.md#020---2026-05-25), [ROADMAP 0.2.0](ROADMAP.md#release-020--remote--server-auth)):

- Flight MCP + UI on Vercel — **live:** [UI](https://mcp-tool-guard-ui.vercel.app/), [health](https://mcp-tool-guard-flight-server.vercel.app/health)
- Remote `mcpUrl`, HTTPS; Bearer token on MCP requests
- Server-side JWT scope enforcement on `tools/call`
- CORS defaults to UI + local Vite; `MCP_CORS_ORIGINS` override

**Next:** [0.3.0 hardening](ROADMAP.md#release-030--hardening--multi-server) — [NEXT-STEPS.md](NEXT-STEPS.md).

---

## 0.3.0 — Hardening & multi-server {#030-hardening--multi-server}

**Shipped 2026-06-02** — tag [`v0.3.0`](https://github.com/peterkrentel/mcp-tool-guard/releases/tag/v0.3.0). See [CHANGELOG 0.3.0](../CHANGELOG.md#030---2026-06-02).

- Auth0 + guest dual trust; Bearer `/audit`; `permissions` claim
- Vercel KV (Upstash) for server audit + bookings — [kv-design.md](kv-design.md)
- Live: [UI](https://mcp-tool-guard-ui.vercel.app/), [health](https://mcp-tool-guard-flight-server.vercel.app/health) (`jwt_trust_enabled`, `kv_enabled`)

**Next:** [post-0.3.0 backlog](NEXT-STEPS.md#implementation-backlog-post-030).

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
3. Set `"version": "0.2.0"` in `package.json`
4. PR → merge `main`
5. Tag and push:
   ```bash
   git checkout main && git pull
   git tag -a v0.2.0 -m "v0.2.0: Remote deploy and server-side JWT"
   git push origin v0.2.0
   ```
6. Create **GitHub Release** from tag; paste CHANGELOG section for 0.2.0
7. Update [ROADMAP.md](ROADMAP.md): mark 0.2.0 complete; set **Next release** to the next milestone

---

## 0.1.0 {#010}

Initial demo: FastMCP flight server, browser UI (WebLLM), `ToolGuard` SDK, server + client audit panels, demo JWTs.

---

## 0.2.0 — Remote & server auth {#020-remote--server-auth}

Planned scope (see [ROADMAP.md](ROADMAP.md#release-020--remote--server-auth), deploy guide [vercel-deploy.md](vercel-deploy.md)):

- Flight MCP + UI on Vercel (or equivalent)
- Remote `mcpUrl`, HTTPS
- Bearer token on MCP requests
- Server-side (or gateway) JWT scope enforcement
- CORS restricted to UI origin

Track implementation in CHANGELOG `[Unreleased]` until release day.

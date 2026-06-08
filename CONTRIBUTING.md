# Contributing

Thanks for helping improve MCPToolGuard. We use a **branch → PR → main** workflow with a **CHANGELOG** on every merge.

**No direct pushes to `main`** — including docs, releases, and agent-assisted edits. Always open a PR.

## Required workflow

1. **Always use a PR.** Do not commit or push directly to `main`. Branch → push branch → open pull request in GitHub UI.
2. **Branch names:** `feature/<name>`, `fix/<name>`, `docs/<name>`, or `release/<version>`
3. **Update [CHANGELOG.md](CHANGELOG.md)** under `[Unreleased]` for every PR (Added / Changed / Fixed / Removed). CI enforces this (Dependabot PRs are exempt; add a `Changed` deps note when merging if needed).
4. **Roadmap work:** If the PR implements [docs/ROADMAP.md](docs/ROADMAP.md), mention the task number in the PR description and check the box when done.
5. **Releases:** Follow [docs/RELEASE.md](docs/RELEASE.md) — CHANGELOG section + version bump; optional `git tag` (no GitHub Releases UI).

```bash
git checkout main && git pull
git checkout -b feature/my-change
# ... edit ...
npm run typecheck
# Update CHANGELOG.md
git push -u origin feature/my-change
# Open PR in GitHub UI (compare branch → main)
```

## Local checks

```bash
make setup          # first time
npm run typecheck
npm run check:demo-policy
make dev            # flight → proxy → ui (or make flight / make proxy / make ui separately)
```

## Docs

| Doc | Purpose |
|-----|---------|
| [README.md](README.md) | Quick start, live demo links |
| [docs/deploy-overview.md](docs/deploy-overview.md) | Deploy map — local vs prod (UI + Render proxy + flight) |
| [docs/vercel-deploy.md](docs/vercel-deploy.md) | Vercel deploy guide (flight + UI) |
| [docs/guard-proxy.md](docs/guard-proxy.md) | Guard proxy — local dev, routes, env |
| [docs/render-deploy.md](docs/render-deploy.md) | Render deploy guide for guard proxy |
| [docs/demo-proxy.md](docs/demo-proxy.md) | Live demo script — proxy proof points |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture — diagrams, components, observability planes |
| [docs/CONCEPT.md](docs/CONCEPT.md) | Design — rationale, JWT, audit trust model, limitations |
| [docs/identity.md](docs/identity.md) | IdP — Auth0 vs Keycloak, Path A vs audit secret |
| [docs/auth0-setup.md](docs/auth0-setup.md) | Auth0 tenant setup + Vercel env |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Planned releases and tiers |
| [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md) | Post–0.3.0 build order |
| [docs/RELEASE.md](docs/RELEASE.md) | How to cut a release |
| [CHANGELOG.md](CHANGELOG.md) | History and unreleased work |

## GitHub settings (maintainers)

Enable on the default branch:

- Require pull request before merging
- Require status checks: **changelog**, **ci / build**, **ci / Flight MCP (Python)**
- Optional: require linear history, disallow force-push

Branch protection cannot be committed from the repo; configure in **Settings → Branches**.

## Questions

Open an issue for design questions; link ROADMAP or CONCEPT sections when relevant.

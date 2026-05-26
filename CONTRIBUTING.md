# Contributing

Thanks for helping improve MCPToolGuard. We use a **branch → PR → main** workflow with a **CHANGELOG** on every merge.

## Required workflow

1. **Do not commit directly to `main`.** Use a branch and open a pull request.
2. **Branch names:** `feature/<name>`, `fix/<name>`, `docs/<name>`, or `release/<version>`
3. **Update [CHANGELOG.md](CHANGELOG.md)** under `[Unreleased]` for every PR (Added / Changed / Fixed / Removed). CI enforces this (Dependabot PRs are exempt; add a `Changed` deps note when merging if needed).
4. **Roadmap work:** If the PR implements [docs/ROADMAP.md](docs/ROADMAP.md), mention the task number in the PR description and check the box when done.
5. **Releases:** Follow [docs/RELEASE.md](docs/RELEASE.md) — version bump, tag, GitHub Release.

```bash
git checkout main && git pull
git checkout -b feature/my-change
# ... edit ...
npm run typecheck
# Update CHANGELOG.md
git push -u origin feature/my-change
gh pr create   # or open PR in GitHub UI
```

## Local checks

```bash
make setup          # first time
npm run typecheck
make flight         # terminal 1
make ui             # terminal 2 — smoke test UI + MCP
```

## Docs

| Doc | Purpose |
|-----|---------|
| [README.md](README.md) | Quick start, deploy commands |
| [docs/CONCEPT.md](docs/CONCEPT.md) | Architecture, JWT, limitations |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Planned releases and tiers |
| [docs/RELEASE.md](docs/RELEASE.md) | How to cut a release |
| [CHANGELOG.md](CHANGELOG.md) | History and unreleased work |

## GitHub settings (maintainers)

Enable on the default branch:

- Require pull request before merging
- Require status checks: **changelog**
- Optional: require linear history, disallow force-push

Branch protection cannot be committed from the repo; configure in **Settings → Branches**.

## Questions

Open an issue for design questions; link ROADMAP or CONCEPT sections when relevant.

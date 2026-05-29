# MCPToolGuard

> A browser-native firewall for AI agent tool calls.
> JWT scope enforcement, audit logging, and telemetry —
> no cloud required, no data leaves your perimeter.

## Live demo

| | Link |
|---|------|
| **Try the UI** | [mcp-tool-guard-ui.vercel.app](https://mcp-tool-guard-ui.vercel.app/) |
| **Flight health** | [mcp-tool-guard-flight-server.vercel.app/health](https://mcp-tool-guard-flight-server.vercel.app/health) |

Pick a JWT scope → **Initialize** → chat. First WebLLM load may take ~1 minute. Deploy details: **[docs/vercel-deploy.md](docs/vercel-deploy.md)**.

## Documentation map

| Doc | Read this for |
|-----|----------------|
| **README** (here) | Quick start, live demo links |
| [docs/vercel-deploy.md](docs/vercel-deploy.md) | **Deploy** — Vercel (flight + UI), env vars, troubleshooting |
| [docs/CONCEPT.md](docs/CONCEPT.md) | **Design** — architecture, dual audit, [unowned MCP](docs/CONCEPT.md#third-party--unowned-mcp), [identity](docs/identity.md) |
| [docs/identity.md](docs/identity.md) | **IdP** — Auth0 vs Keycloak, audit auth paths, env vars |
| [docs/auth0-setup.md](docs/auth0-setup.md) | **Auth0 prep** — dashboard checklist (before 0.3 code) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | **Plan** — [0.3 Auth0 + hardening](docs/ROADMAP.md#release-030--hardening--multi-server) |
| [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md) | **What to build next** — Phase A–D |
| [CHANGELOG.md](CHANGELOG.md) | What shipped (`0.2.0`) and [Unreleased](CHANGELOG.md#unreleased) |
| [docs/RELEASE.md](docs/RELEASE.md) · [CONTRIBUTING.md](CONTRIBUTING.md) | Releases and PR workflow |

## Quick start

**First time only:**

```bash
make setup
```

Installs Python deps (`uv sync`), Node deps (`npm install`), and generates demo JWT keys (private key stays in `keys/`, gitignored).

**Every time — two terminals:**

```bash
make flight    # Terminal 1 → http://localhost:8000/mcp
make ui        # Terminal 2 → http://localhost:5173
```

Open `http://localhost:5173`, pick a **JWT scope**, click **Initialize**, then chat. Vite proxies `/mcp` to the flight server locally.

<details>
<summary>Manual commands</summary>

```bash
uv sync --directory servers/flight && npm install && npm run generate-keys
uv run --directory servers/flight python server.py   # terminal 1
npm run dev -w ui                                     # terminal 2
```

</details>

**Try it:** *"Search flights from SFO to JFK"* with read-only, then *"Cancel booking BK-…"* with the same token — scope denial shows in the audit panel. Token details: [CONCEPT → JWT](docs/CONCEPT.md#jwt--demo-tokens).

## Stack

| Layer | Location |
|-------|----------|
| Flight MCP server (Python, FastMCP) | `servers/flight/` |
| `ToolGuard` SDK (TypeScript) | `gateway/` |
| Demo UI (Vite, WebLLM) | `ui/` |

Architecture and audit model: **[docs/CONCEPT.md](docs/CONCEPT.md)**.

## Repo structure

```
mcp-tool-guard/
├── Makefile
├── gateway/          ← ToolGuard SDK (JWT + scopes + audit logger)
├── ui/               ← WebLLM agent + audit panel
├── servers/flight/   ← MCP server + server-side guard
├── docs/             ← CONCEPT, ROADMAP, vercel-deploy, RELEASE
└── scripts/generate-keys.mjs
```

## Deploy

**Full walkthrough:** [docs/vercel-deploy.md](docs/vercel-deploy.md)

| Project | Key settings |
|---------|----------------|
| **Flight** (`servers/flight`) | Root `servers/flight`; empty install/build; `MCP_GUARD_PUBLIC_KEY_PEM` |
| **UI** (repo root) | `npm ci` + build gateway + ui; output `ui/dist`; `VITE_MCP_URL` → flight `/mcp` |

Demo JWTs ship in `ui/public/demo-tokens.json` — no token env vars on the UI project.

Regenerate Python deps after `pyproject.toml` changes:

```bash
uv export --directory servers/flight --no-hashes -o servers/flight/requirements.txt
```

## Contributing

Feature branch + PR; update [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

# MCPToolGuard

> A browser-native firewall for AI agent tool calls.
> JWT scope enforcement, audit logging, and telemetry —
> no cloud required, no data leaves your perimeter.

## Documentation map

| Doc | Read this for |
|-----|----------------|
| **README** (here) | Quick start, commands, deploy env vars |
| [docs/CONCEPT.md](docs/CONCEPT.md) | **Design** — architecture, dual audit, observability scope, JWT, limitations |
| [docs/ROADMAP.md](docs/ROADMAP.md) | **Plan** — release 0.2.0 tasks and future tiers |
| [CHANGELOG.md](CHANGELOG.md) | What shipped and what is in progress |
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
├── docs/             ← CONCEPT, ROADMAP, RELEASE
└── scripts/generate-keys.mjs
```

## Deploy

**UI** — `npm run build -w ui`, deploy `ui/dist/`.

| Variable | Purpose |
|----------|---------|
| `VITE_MCP_URL` | Remote flight MCP URL (omit for local `/mcp` proxy) |

**Flight MCP** — deploy `servers/flight/` (e.g. Vercel). See [CONCEPT → Remote deployment](docs/CONCEPT.md#remote-deployment).

| Variable | Purpose |
|----------|---------|
| `MCP_GUARD_PUBLIC_KEY_PEM` | RS256 public key (or use committed `ui/public/demo-public.pem` locally) |
| `MCP_GUARD_ENABLED` | Set `false` to disable server guard (debug only) |

Endpoints: `/mcp`, `/health`, `/audit` (server enforcement log).

Regenerate Python deps after `pyproject.toml` changes:

```bash
uv export --directory servers/flight --no-hashes -o servers/flight/requirements.txt
```

## Contributing

Feature branch + PR; update [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

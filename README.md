# MCPToolGuard

> A browser-native firewall for AI agent tool calls.
> JWT scope enforcement, audit logging, and telemetry —
> no cloud required, no data leaves your perimeter.

## Stack

Two separate concerns, two separate terminals:

```
Python (uv + venv)          Node (npm + Vite)
└── servers/flight/         └── ui/ + gateway/
    Flight MCP server           WebLLM, agent loop, dashboard
    No npm needed               TypeScript gateway layer
```

| Layer | Tooling | Location |
|-------|---------|----------|
| Flight MCP server | uv, venv, FastMCP | `servers/flight/` |
| JWT gateway | TypeScript | `gateway/` |
| Browser UI | Vite, WebLLM | `ui/` |

## Quick start

**First time only:**

```bash
make setup
```

Installs Python deps (`uv sync`), Node deps (`npm install`), and generates demo JWT keys.

**Every time after that — two terminals:**

```bash
make flight    # Terminal 1 → http://localhost:8000/mcp
make ui        # Terminal 2 → http://localhost:5173
```

No `cd`, no `source .venv/bin/activate` — `uv run` handles the venv automatically.

Open `http://localhost:5173`, click **Initialize**, then chat with the agent. Vite proxies `/mcp` to the flight server.

<details>
<summary>Manual commands (if you prefer)</summary>

```bash
# First time
uv sync --directory servers/flight
npm install
npm run generate-keys

# Every time
uv run --directory servers/flight python server.py   # terminal 1
npm run dev -w ui                                     # terminal 2
```

</details>

### Demo JWT tokens

`make setup` generates demo keys and tokens. Pick a profile in the UI (**JWT scope** dropdown), then **Initialize**.

Full details — file paths, claims, enforcement flow, production notes — are in **[docs/CONCEPT.md → JWT & demo tokens](docs/CONCEPT.md#jwt--demo-tokens)**.

Quick try: *"Search flights from SFO to JFK"* with read-only, then *"Cancel booking BK-…"* with the same token to see a scope denial in the audit log.

## Architecture

```
Browser (Vite + WebLLM):
├── WebLLM              ← local LLM, no API key required
├── Agent loop          ← reasoning happens client side
├── ToolGuard (gateway/) ← SDK pre-check + agent-attempt audit (before network)
└── MCP client           ← tools/call with Bearer JWT → flight server enforces + server audit
```

**Audit:** Agent attempts (browser) show what the agent tried; server enforcement (`GET /audit`) is the authoritative record. See [docs/CONCEPT.md](docs/CONCEPT.md#two-audit-planes-demo-ui).

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/CONCEPT.md](docs/CONCEPT.md) | Architecture, JWT, current limitations |
| [docs/ROADMAP.md](docs/ROADMAP.md) | **Next release 0.2.0** and future tiers |
| [docs/RELEASE.md](docs/RELEASE.md) | Branch, PR, tagging, cutting a release |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Required workflow (branch + PR + CHANGELOG) |
| [CHANGELOG.md](CHANGELOG.md) | Unreleased work and version history |

## Repo structure

```
mcp-tool-guard/
├── Makefile              ← setup, flight, ui shortcuts
├── gateway/              ← JWT enforcement (TypeScript, consumed by ui/)
│   ├── guard.ts
│   ├── logger.ts
│   └── config.yaml
├── ui/                   ← Vite app (WebLLM + dashboard)
│   ├── index.html
│   ├── vite.config.ts
│   ├── public/           ← demo-public.pem, demo-tokens.json
│   └── src/
├── servers/
│   └── flight/           ← FastMCP server (Python + uv)
│       ├── server.py
│       ├── mock_data.py
│       ├── pyproject.toml
│       ├── api/index.py  ← Vercel entrypoint
│       └── vercel.json
├── docs/
│   ├── CONCEPT.md
│   ├── ROADMAP.md
│   └── RELEASE.md
├── CHANGELOG.md
├── CONTRIBUTING.md
└── scripts/
    └── generate-keys.mjs   ← demo RSA key pair + JWTs
```

## Production build (UI)

```bash
npm run build -w ui     # output in ui/dist/
npm run preview -w ui   # local preview of production build
```

Deploy `ui/dist/` to Vercel, Netlify, or any static host.

**Environment (UI project):**

| Variable | Example | Purpose |
|----------|---------|---------|
| `VITE_MCP_URL` | `https://your-flight.vercel.app/mcp` | Remote flight MCP (omit for local `/mcp` proxy) |

**Environment (flight MCP project):**

| Variable | Purpose |
|----------|---------|
| `MCP_GUARD_PUBLIC_KEY_PEM` | RS256 public key (Vercel: paste PEM contents) |
| `MCP_GUARD_ENABLED` | Set `false` to disable server guard (dev only) |

Server guard reads `ui/public/demo-public.pem` locally when env is unset. Disable guard only for debugging — production should keep it enabled.

## Deploy Flight MCP to Vercel

```bash
cd servers/flight
vercel
```

Regenerate `requirements.txt` after changing `pyproject.toml`:

```bash
uv export --directory servers/flight --no-hashes -o servers/flight/requirements.txt
```

MCP endpoint: `https://<project>.vercel.app/mcp`  
Health: `https://<project>.vercel.app/health`  
Audit (server-side log): `https://<project>.vercel.app/audit`

## Tool scope config

Per-tool scopes live in `gateway/config.yaml` (mirrored in `ui/src/guard-config.ts` for the browser):

```yaml
servers:
  flight:
    url: http://localhost:8000/mcp
    tools:
      search_flights_tool:
        required_scope: flights:read
      cancel_booking_tool:
        required_scope: flights:delete
        alert: true
        log_level: verbose
```

## Core principle

No cloud dependency for the LLM. MCP calls go only to servers you configure. See [docs/CONCEPT.md](docs/CONCEPT.md) for demo limitations and [docs/ROADMAP.md](docs/ROADMAP.md) for the path to remote deploy and server-side auth.

## Contributing

Use a feature branch and pull request; update [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

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

`make setup` writes `ui/public/demo-public.pem` and `ui/public/demo-tokens.json`. Regenerate anytime with `make keys`.

| Profile   | Scopes                          | Search | Book | Cancel |
|-----------|----------------------------------|--------|------|--------|
| Read only | `flights:read`                   | Yes    | No   | No     |
| Booking   | `flights:read`, `flights:write`  | Yes    | Yes  | No     |
| Admin     | all flight scopes                | Yes    | Yes  | Yes    |

Try: *"Search flights from SFO to JFK"* with read-only, then *"Cancel booking BK-..."* to see denial.

## Architecture

```
Browser (Vite + WebLLM):
├── WebLLM              ← local LLM, no API key required
├── Agent loop          ← reasoning happens client side
├── MCPToolGuard layer  ← JWT validation + scope enforcement (gateway/)
│    ├── validate JWT signature
│    ├── check token expiry
│    ├── read scopes from token
│    ├── match against tool config
│    ├── allow or deny
│    └── log every decision
└── MCP client          ← calls flight server via Vite proxy
```

See [docs/CONCEPT.md](docs/CONCEPT.md) for the full design.

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
│   └── CONCEPT.md
└── scripts/
    └── generate-keys.mjs   ← demo RSA key pair + JWTs
```

## Production build (UI)

```bash
npm run build -w ui     # output in ui/dist/
npm run preview -w ui   # local preview of production build
```

Deploy `ui/dist/` to Vercel, Netlify, or any static host. Point `mcpUrl` in the agent at your deployed flight server URL.

## Deploy Flight MCP to Vercel

```bash
cd servers/flight
vercel
```

Regenerate `requirements.txt` after changing `pyproject.toml`:

```bash
uv export --directory servers/flight --no-hashes -o servers/flight/requirements.txt
```

MCP endpoint: `https://<project>.vercel.app/api`

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

No cloud dependency. No data leaving the browser except to MCP servers the user explicitly configured. No vendor lock-in. Works anywhere. Private by default.

## License

MIT

# Demo screenshots

Production UI captures referenced from the repo docs (not Auth0 dashboard walkthrough — see [auth0/README.md](../auth0/README.md)).

| File | Used in | What it shows |
|------|---------|---------------|
| `prod-ui-audit-success.png` | [README Live demo](../../README.md#live-demo) | Prod UI + audit panel after successful Auth0 + MCP flow |
| `auth0-access-token-jwtio.png` | [README Live demo](../../README.md#live-demo) | Decoded access token — admin `permissions` (`flights:*`) |
| `auth0-access-token-read-only-jwtio.png` | [README Live demo](../../README.md#live-demo), [auth0-setup](../auth0-setup.md) | Read-only user — `permissions`: `["flights:read"]` only |
| `prod-scope-deny-read-only.png` | [README Live demo](../../README.md#live-demo), [auth0-setup](../auth0-setup.md) | Read-only user — book blocked, **Agent attempts** DENY (no server row) |
| `track2-github-curl-read-allow.png` | [Track 2 proof](../track2-github-proof.md), [demo-proxy Demo 6](../demo-proxy.md#demo-6--github-mcp-external-upstream) | curl `get_file_contents` — SSE `result` with README via `/github/mcp` |
| `track2-github-render-logs.png` | [Track 2 proof](../track2-github-proof.md) | Render: `allow get_file_contents` at `source=proxy` and `source=mcp` |
| `track2-github-agent-jwtio.png` | [Track 2 proof](../track2-github-proof.md) | M2M agent JWT — `repo:read`, `repo:write`, `@clients` |
| `track2-github-agent-client-deny.png` | [Track 2 proof](../track2-github-proof.md) | Optional — client pre-check deny when agent policy/server mismatch |

**Flight proxy demo:** [demo-proxy.md](../../demo-proxy.md) Demos 1–5 — Network tab → `onrender.com`, Render logs, curl deny with `Accept: application/json, text/event-stream`.

Do **not** commit secrets (tokens, full `.env.local`).

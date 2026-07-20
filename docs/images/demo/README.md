# Demo screenshots

Production UI captures referenced from the repo docs (not Auth0 dashboard walkthrough — see [auth0/README.md](../auth0/README.md)).

| File | Used in | What it shows |
|------|---------|---------------|
| `slack-approval-queue.png` | [README Live demo](../../README.md#live-demo) | Slack approval queue in `/agents.html` — pending `slack_send_message` approved and retried |
| `slack-terminal-trace.png` | [README Live demo](../../README.md#live-demo) | Terminal trace with agent / proxy / MCP `trace_id` correlation for Slack validation |
| `slack-grafana-overview.png` | [README Live demo](../../README.md#live-demo) | Grafana proxy telemetry overview for Slack / OTel validation |
| `slack-grafana-latency-denials.png` | [README Live demo](../../README.md#live-demo) | Grafana latency panel showing Slack request spikes and deny activity |
| `slack-grafana-denied-pending.png` | [README Live demo](../../README.md#live-demo) | Grafana denied/pending calls panel with Slack approval flow trace IDs |
| `slack-channel-success.png` | [README Live demo](../../README.md#live-demo) | Slack channel success message after approval and token-based retry |
| `prod-ui-audit-success.png` | [README Live demo](../../README.md#live-demo) | Prod UI + audit panel after successful Auth0 + MCP flow |
| `auth0-access-token-jwtio.png` | [README Live demo](../../README.md#live-demo) | Decoded access token — admin `permissions` (`flights:*`) |
| `auth0-access-token-read-only-jwtio.png` | [README Live demo](../../README.md#live-demo), [auth0-setup](../auth0-setup.md) | Read-only user — `permissions`: `["flights:read"]` only |
| `prod-scope-deny-read-only.png` | [README Live demo](../../README.md#live-demo), [auth0-setup](../auth0-setup.md) | Read-only user — book blocked, **Agent attempts** DENY (no server row) |
| `track2-github-curl-read-allow.png` | [Track 2 proof](../track2-github-proof.md), [demo-proxy Demo 6](../demo-proxy.md#demo-6--github-mcp-external-upstream) | curl `get_file_contents` — SSE `result` with README via `/github/mcp` |
| `track2-github-render-logs.png` | [Track 2 proof](../track2-github-proof.md) | Render: `allow get_file_contents` at `source=proxy` and `source=mcp` |
| `track2-github-agent-jwtio.png` | [Track 2 proof](../track2-github-proof.md) | M2M agent JWT — `repo:read`, `repo:write`, `@clients` |
| `track2-github-curl-write-deny.png` | [Track 2 proof](../track2-github-proof.md), [demo-proxy Demo 6](../demo-proxy.md#demo-6--github-mcp-external-upstream) | curl `create_or_update_file` — proxy `-32001` (plain JSON, not SSE) |
| `track2-github-render-deny-logs.png` | [Track 2 proof](../track2-github-proof.md) | Render: `deny create_or_update_file` at `source=proxy` |
| `track2-github-agent-readonly-jwtio.png` | [Track 2 proof](../track2-github-proof.md) | Read-only M2M agent — `permissions`: `["repo:read"]` |
| `track2-github-agent-readonly-ui.png` | [Track 2 proof](../track2-github-proof.md) | `/agents.html` — `github-test01-read` agent |
| `track2-github-agent-client-deny.png` | [Track 2 proof](../track2-github-proof.md) | Optional — client pre-check deny when agent policy/server mismatch |
| `claude-code-ops-approval.png` | [Claude Code prod demo](../claude-code-demo.md) | Claude Code ops view — a `repo:write` `create_or_update_file` request from a `repo:read`-only agent, held pending and approved live |

**Flight proxy demo:** [demo-proxy.md](../../demo-proxy.md) Demos 1–5 — Network tab → `onrender.com`, Render logs, curl deny with `Accept: application/json, text/event-stream`.

Do **not** commit secrets (tokens, full `.env.local`).

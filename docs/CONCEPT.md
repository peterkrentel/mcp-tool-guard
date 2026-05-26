# MCPToolGuard — Concept

## Problem

AI agents call MCP tools with broad access. Without enforcement, any agent session can invoke destructive operations — cancel bookings, push code, send messages — with no audit trail.

## Solution

MCPToolGuard validates **JWT scopes** against per-tool policy before an MCP `tools/call` runs, and logs every allow/deny decision.

1. **Validate JWT** — signature, expiry (via public key or JWKS)
2. **Read scopes** from the token (`flights:read`, `flights:write`, etc.)
3. **Match** against `gateway/config.yaml`
4. **Allow or deny** before the MCP call
5. **Audit** structured JSON per decision

Setup and stack: [README](../README.md). Planned work: [ROADMAP.md](ROADMAP.md).

## Architecture

```
Browser tab (Vite + WebLLM)
├── WebLLM              ← local LLM (not the MCP caller)
├── Agent loop          ← ui/src/agent.ts
├── MCPToolGuard        ← gateway/guard.ts
└── MCP HTTP client     ← ui/src/mcp-client.ts
         │
         │  HTTP (HTTPS in prod)
         ▼
Flight MCP server       ← servers/flight/ (separate process / deploy)
```

The **MCP caller** is the browser client (`mcp-client.ts`), not WebLLM. WebLLM only proposes tool JSON; the agent executes guarded MCP calls.

## Current limitations (demo)

| Limitation | Detail |
|------------|--------|
| Guard location | Enforced in the **browser** only; flight server does not validate JWT |
| MCP clients | CLI/Cursor can call flight directly and bypass the guard |
| Agent loop | Single tool call per user message (no multi-step ReAct) |
| UI servers | `guard-config.ts` wires **flight** only; yaml lists slack/github stubs unused |
| MCP features | No prompts, elicitation, or resources |
| Data | Mock in-memory flights/bookings |

## Remote deployment

Production shape:

- **UI** and **flight MCP** on separate HTTPS origins (e.g. two Vercel projects).
- Browser sends `Authorization: Bearer <access_token>` on every MCP request.
- **Server** (or API gateway) must enforce the same scopes as `ToolGuard` — client-only checks are not sufficient when MCP is public.
- **HTTPS + JWT scopes** for browser → MCP; **mTLS** is optional and mainly for service-to-service hops, not typical browser clients.

See [ROADMAP 0.2.0](ROADMAP.md#release-020--remote--server-auth).

## Authorization model

The JWT **is** the authorization. No separate IAM database in the demo. Any OAuth 2.0 / OIDC provider can issue scoped tokens; the gateway is stateless (public key + YAML config).

## JWT & demo tokens

Canonical reference for tokens in this repo.

### Files

| Path | Purpose | Committed? |
|------|---------|------------|
| `keys/demo-private.pem` | Signs demo JWTs | No (gitignored) |
| `keys/demo-public.pem` | Local copy of public key | No (gitignored) |
| `ui/public/demo-public.pem` | PEM for browser verify | Yes |
| `ui/public/demo-tokens.json` | `read_only`, `booking`, `admin` JWTs | Yes |

Regenerate: `make keys` or `npm run generate-keys` (`make setup` runs this on first install).

### Token format

- **Algorithm:** RS256
- **Claims:** `sub`, `iat`, `exp`; **`scope`** (space-separated, e.g. `flights:read flights:write`)
- **Demo-only:** `label` (not used for enforcement)
- Gateway also accepts `scopes` or `scp` for IdP compatibility

### Demo profiles

| UI key | Scopes | Search | Book | Cancel |
|--------|--------|--------|------|--------|
| `read_only` | `flights:read` | Yes | No | No |
| `booking` | `flights:read`, `flights:write` | Yes | Yes | No |
| `admin` | + `flights:delete` | Yes | Yes | Yes |

UI: **JWT scope** dropdown → **Initialize** → loads PEM + tokens; `ToolGuard.authorize("flight", tool, jwt)` on each call.

### Enforcement today

```
ToolGuard.authorize → jwtVerify → checkScope vs config.yaml → allow/deny → mcp.callTool
```

Config: `gateway/config.yaml` (mirrored in `ui/src/guard-config.ts`). Wildcards: `flights:*` or `*`.

### Production

Use IdP-issued tokens and JWKS; do not ship private keys or long-lived prod tokens in the repo.

## Security layers

1. **Transport** — HTTPS (mTLS optional for service-to-service)
2. **Identity** — JWT bearer
3. **Authorization** — per-tool scope from config
4. **Audit** — structured log
5. **Alerts** — per tool (e.g. `cancel_booking_tool`)

## What this is not

- Not a SaaS IdP — it consumes tokens, does not issue them (except demo keys)
- Not a replacement for server-side auth when MCP is remote
- Not cloud-dependent for the LLM — WebLLM runs in the browser

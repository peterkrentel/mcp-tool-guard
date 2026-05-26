# MCPToolGuard — Concept

## Problem

AI agents call MCP tools with broad access. Without enforcement, any agent session can invoke destructive operations — cancel bookings, push code, send messages — with no audit trail.

## Solution

MCPToolGuard sits between the agent and MCP servers as a **client-side gateway**:

1. **Validate JWT** — signature, expiry, issuer (via public key)
2. **Read scopes** from the token (`flights:read`, `flights:write`, etc.)
3. **Match** against per-tool config (`gateway/config.yaml`)
4. **Allow or deny** before the MCP call is made
5. **Log** every decision as structured JSON

## Architecture

```
Browser tab (Vite + WebLLM)
├── WebLLM              ← local LLM inference
├── Agent loop          ← reasons about tool use
├── MCPToolGuard        ← JWT + scope enforcement + audit log (gateway/)
└── MCP HTTP client     ← calls configured MCP servers
```

Flight MCP server runs separately (Python + uv) and is reached over HTTP.

## Stack

| Component | Technology |
|-----------|------------|
| Flight MCP server | Python, FastMCP, uv |
| JWT gateway | TypeScript (`gateway/`) |
| Browser UI | Vite, WebLLM (`ui/`) |

See the [README](../README.md) for setup (`make setup`, then `make flight` + `make ui`).

## Authorization model

The JWT **is** the authorization. No separate IAM database. Any OAuth 2.1 identity provider can issue scoped tokens. The gateway is stateless — it only needs the public key and YAML config.

## JWT & demo tokens

This is the single reference for how tokens work in the repo.

### Files

| Path | Purpose | Committed? |
|------|---------|------------|
| `keys/demo-private.pem` | Signs demo JWTs (`scripts/generate-keys.mjs`) | No (gitignored) |
| `keys/demo-public.pem` | Copy of public key for local tooling | No (gitignored) |
| `ui/public/demo-public.pem` | PEM served to the browser for signature verify | Yes |
| `ui/public/demo-tokens.json` | Three pre-signed JWT strings (`read_only`, `booking`, `admin`) | Yes |

Regenerate after clone or when scopes change:

```bash
make keys
# or: npm run generate-keys
```

`make setup` runs key generation on first install.

### Token format

- **Algorithm:** RS256 (RSA 2048-bit key pair)
- **Library:** [`jose`](https://github.com/panva/jose) in `gateway/guard.ts` and `scripts/generate-keys.mjs`
- **Standard claims:** `sub` (`demo-user`), `iat`, `exp` (1 year for demos)
- **Authorization claim:** `scope` — space-separated OAuth-style scopes, e.g. `flights:read flights:write`
- **Demo-only claim:** `label` — human-readable profile name (`read-only`, `booking`, `admin`); not used for enforcement

Example payload (decoded):

```json
{
  "scope": "flights:read flights:write",
  "label": "booking",
  "sub": "demo-user",
  "iat": 1710000000,
  "exp": 1741536000
}
```

The gateway also accepts `scopes` or `scp` if your IdP uses those instead of `scope`.

### Demo profiles

| UI key (`demo-tokens.json`) | Label | Scopes | Search | Book | Cancel |
|-----------------------------|-------|--------|--------|------|--------|
| `read_only` | read-only | `flights:read` | Yes | No | No |
| `booking` | booking | `flights:read`, `flights:write` | Yes | Yes | No |
| `admin` | admin | `flights:read`, `flights:write`, `flights:delete` | Yes | Yes | Yes |

In the UI, pick a profile from the **JWT scope** dropdown, then click **Initialize**. The app loads `/demo-public.pem` and `/demo-tokens.json`, builds `ToolGuard` with the public key, and passes the selected JWT on every tool call.

### Where enforcement happens

```
User message → WebLLM → agent picks tool
                              ↓
                    ToolGuard.authorize(server, tool, jwt)
                    ├── jwtVerify (signature + exp)
                    ├── extractScopes from payload
                    └── checkScope vs gateway/config.yaml
                              ↓
                    allow → MCP HTTP call   deny → audit log, no call
```

- **Enforced in:** browser via `gateway/guard.ts` (imported by `ui/src/agent.ts`)
- **Config:** `gateway/config.yaml` maps each tool to `required_scope` (e.g. `cancel_booking_tool` → `flights:delete`)
- **Not enforced in:** the Flight MCP server (`servers/flight/`) — it accepts any HTTP client on `/mcp` with no bearer token. For a real deployment, either network-isolate the server or add server-side validation; this demo keeps auth at the gateway layer only.

Wildcard scopes are supported: `flights:*` or `*` satisfies any `flights:…` requirement.

### Production use

Replace demo keys with your IdP’s JWKS or PEM, issue tokens with the same `scope` claim shape, and point `ToolGuard` at your public key. Do not commit private keys or long-lived production tokens to the repo.

## Demo: Flight MCP

The included Flight MCP server (`servers/flight/`) provides mock airline tools. Use the [demo JWT profiles](#demo-profiles) above to try allow/deny: e.g. search with read-only, then attempt cancel without `flights:delete`.

## Security layers

1. **Transport** — HTTPS (mTLS optional)
2. **Identity** — JWT bearer token
3. **Authorization** — per-tool scope from config
4. **Audit** — structured log of every call
5. **Alerts** — configurable per tool (e.g. `cancel_booking_tool`)

## What this is not

- Not a SaaS product
- Not a replacement for your identity provider
- Not cloud-dependent — runs entirely in the browser

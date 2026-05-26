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

## Demo: Flight MCP

The included Flight MCP server (`servers/flight/`) provides mock airline tools. Three demo JWT profiles illustrate scope enforcement:

| Token     | Scopes                          | Can search | Can book | Can cancel |
|-----------|----------------------------------|------------|----------|------------|
| Read only | `flights:read`                   | Yes        | No       | No         |
| Booking   | `flights:read`, `flights:write`  | Yes        | Yes      | No         |
| Admin     | all three                        | Yes        | Yes      | Yes        |

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

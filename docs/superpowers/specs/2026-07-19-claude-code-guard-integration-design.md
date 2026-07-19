# BL-037: Claude Code Harness Integration Guide

## Status

Design for a docs-plus-smoke-test deliverable. No new gateway/proxy code required — this connects an existing, unmodified MCP client (Claude Code) to already-working guard infrastructure (the local dev proxy + the registered `github` server) and documents what actually happens, since none of it has been verified before.

## Context

The guard proxy is a standard MCP-over-HTTP server with Bearer auth, which by construction is harness-agnostic (this is `BL-037`'s own backlog source note). Until now the only MCP client ever exercised against it is this project's own browser SDK (`ui/src/agent.ts`/`gateway-agent.ts`), which generates its own `X-Trace-Id`/`X-Session-Id` conventions and posts to `/audit/agent`. Claude Code is a completely independent, Anthropic-built MCP client with no knowledge of those conventions — connecting it surfaces the first real test of whether the guard's "harness-agnostic" claim holds, and what breaks or degrades when a second, differently-behaved client is used.

## Decision: target server is GitHub, not flight

`servers/flight` runs its own embedded guard (`servers/flight/guard.py`, demo-only tech debt per `BL-010`) — testing against it would not cleanly demonstrate the proxy as the sole enforcement point, since flight would independently re-check the same token. `github` (registered in `gateway/config.yaml`, no embedded guard of its own, upstream-token-based) is the correct target: the proxy is the *only* enforcement layer standing between Claude Code and the real GitHub MCP server, and it's the exact example already named in `BL-037`'s acceptance text.

## Architecture

```
Claude Code (MCP client)                Browser (/agents.html, a DIFFERENT MCP client)
        |                                          |
        | .mcp.json: headersHelper script          | own SDK: X-Trace-Id, X-Session-Id,
        | injects Authorization + X-Trace-Id       | POST /audit/agent
        |                                          |
        +-------------------- both hit -------------------+
                                |
                    guard proxy (localhost:8787)
                     - validates JWT, checks scope
                     - allow -> forwards to real GitHub
                     - deny/pending -> proxy answers directly, GitHub never contacted
                                |
                        real GitHub MCP server
```

Claude Code never talks to GitHub directly, and never learns a guard exists — it just gets a JSON-RPC response (successful, denied, or pending) from what it believes is "the GitHub MCP server." Claude Code's own local per-tool approval prompt is a separate, client-side gate that fires before any network request — independent of, and unaware of, the proxy's scope check on the request itself. That's the "dual approval" the acceptance text refers to.

## Components

### 1. `scripts/claude-mcp-token-helper.sh` (new)

Reads `MCP_AGENT_CLIENT_ID`/`MCP_AGENT_CLIENT_SECRET`/`PROXY_URL` (default `http://localhost:8787`) from the environment, `POST`s to `$PROXY_URL/token` (plain client_credentials — no admin auth needed, this is exactly what `/token` already exists for), and writes to stdout:

```json
{
  "Authorization": "Bearer <vended-jwt>",
  "X-Trace-Id": "<uuid, generated once per script invocation>"
}
```

No client-side token caching needed — `TokenVendor` already caches server-side. The `X-Trace-Id` is a fresh UUID each time the script runs (i.e., once per Claude Code connect/reconnect), giving a **session-level** grouping key in the audit trail — not per-individual-tool-call granularity, since `headersHelper` only re-runs at connect time, not per request. This is documented explicitly as a known limitation, not implied to match the browser's per-turn correlation.

### 2. `.mcp.json` entry (documented, not committed — user-local config)

```json
{
  "mcpServers": {
    "github-guarded": {
      "type": "http",
      "url": "http://localhost:8787/github/mcp",
      "headersHelper": "./scripts/claude-mcp-token-helper.sh"
    }
  }
}
```

### 3. `docs/claude-code-integration.md` (new)

Following the existing docs' structure (`auth0-setup.md`/`render-deploy.md` style — prerequisites, steps, verification checklist, troubleshooting table). Documents, as **actually observed during the smoke test**, not assumed:

- **Read-allow**: `get_file_contents` (`repo:read`) with a `repo:read`-only local agent — proxy allows, forwards to real GitHub, Claude Code's own approval prompt still fires separately beforehand.
- **Write-deny**: `create_or_update_file` (`repo:write`) with the same agent, `MCP_APPROVAL_QUEUE` off — proxy denies before GitHub is ever contacted; documents exactly what Claude Code surfaces to the model for that JSON-RPC error shape.
- **Write-pending**: same call, approval queue on — proxy returns its own non-standard `202`/`status: "pending"` shape (not part of the MCP spec); documents exactly how Claude Code's client renders that (pass-through as a tool result vs. an error), since this has never been tested against any client other than the browser SDK.
- **`headersHelper` behavior and its real limitation**: documents the actual mechanism (script path, JSON-on-stdout, 10s timeout, runs at connect/reconnect), the v2.1.193 retry-once-on-401 behavior, and the known bug where it isn't reliably re-invoked mid-session on long-lived HTTP transport ([anthropics/claude-code#53267](https://github.com/anthropics/claude-code/issues/53267)) — so a 1-hour token can go stale mid-session with no automatic recovery beyond that one retry.
- **Observability gap, stated plainly**: Claude Code's calls appear in `GET /audit` as `source: "proxy"` only (never `source: "agent"`, since Claude Code never posts to `/audit/agent` — that's the browser SDK's own pre-check mechanism). With the helper's injected `X-Trace-Id`, calls from one Claude Code session are groupable by that one shared id — but not distinguishable per individual tool call the way the browser's per-turn trace_id is.
- **Generalization note**: the underlying pattern (guard proxy in front, Bearer JWT via a refreshable-header mechanism) is harness-agnostic by construction — any MCP client supporting remote HTTP servers with a custom auth header (OpenCode, VS Code's native MCP support, etc.) should work the same way. Only the per-harness config syntax differs. Documenting other harnesses is explicitly out of scope for this task (YAGNI — the user only uses Claude Code today); a future ticket can add a config section per additional harness without any guard-side changes.

## Explicitly out of scope

- `servers/flight` as a target (has its own embedded guard, not representative — see Decision above).
- Fixing Claude Code's `headersHelper` mid-session refresh bug (external, upstream — link and document it, don't attempt a workaround inside this project).
- Per-individual-tool-call trace correlation for Claude Code (would require either the proxy accepting a client-generated trace_id per MCP request body, which Claude Code has no mechanism to set per-call, or building a new proxy-side heuristic — not attempted here; session-level grouping via `headersHelper` is the full scope of the observability improvement in this task).
- Documenting other MCP harnesses (OpenCode, VS Code, Cursor) — noted as a generalizable future extension, not built here.
- Any new gateway/proxy code — this task is 100% docs + one small shell script, using already-shipped BL-020-era infrastructure (`/token`, `TokenVendor`, existing scope enforcement).

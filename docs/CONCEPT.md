# MCPToolGuard — Concept

**Navigation:** [Quick start](../README.md) · [Live demo](vercel-deploy.md#live-demo) · [Vercel deploy](vercel-deploy.md) · [Next steps](NEXT-STEPS.md) · [Roadmap](ROADMAP.md) · [Changelog](../CHANGELOG.md)

Design reference for the repo. Task checklists and release status live in [ROADMAP.md](ROADMAP.md) only.

## Problem

AI agents call MCP tools with broad access. Without enforcement, any agent session can invoke destructive operations — cancel bookings, push code, send messages — with no audit trail.

## Solution

MCPToolGuard validates **JWT scopes** against per-tool policy on MCP `tools/call` and logs every allow/deny decision.

1. **Validate JWT** — signature, expiry (public key or JWKS)
2. **Read scopes** from the token (`flights:read`, `flights:write`, …)
3. **Match** against tool policy (YAML / `guard-config.ts`)
4. **Allow or deny** — server is authoritative; client SDK can pre-check first
5. **Audit** — structured JSON per decision (`session_id`, `trace_id`)

## Architecture

```
Browser tab (Vite + WebLLM)
├── WebLLM              ← local LLM (not the MCP caller)
├── Agent loop          ← ui/src/agent.ts
├── ToolGuard (SDK)     ← gateway/guard.ts — pre-check + agent-attempt log
└── MCP HTTP client     ← ui/src/mcp-client.ts (Bearer JWT)
         │
         │  HTTP / HTTPS
         ▼
Flight MCP server       ← servers/flight/ — guard middleware on tools/call
```

The **MCP caller** is `mcp-client.ts`, not WebLLM. WebLLM proposes tool JSON; the agent runs `ToolGuard.authorize`, then `tools/call` when allowed.

### Two audit planes (demo UI)

| Plane | Question | Trust |
|-------|----------|-------|
| **Agent attempts** (client `ToolGuard` log) | What did the agent try? Blocked before network? | Observability / debugging only |
| **Server enforcement** (`GET /audit`) | What reached MCP? JWT valid? Allow/deny? | **Authoritative** security record |

Correlate with `trace_id` when both exist. **No server row after a client deny is expected** — the attempt still appears under Agent attempts.

For compliance and production dashboards, use **server** guard JSON (Tier 2 → Grafana/Loki), not the browser log.

## Observability scope

Agent observability often spans **metrics** (latency, tokens, error rates), **traces** (step-by-step model and tool calls), and **logs/events** (discrete decisions and failures). MCPToolGuard focuses on the **tool boundary** — not a full “glass box” for the LLM.

**What we answer**

| Question | Signal type | How |
|----------|-------------|-----|
| Which tool did the agent try? | Logs / events | Client agent-attempt audit |
| Did it reach MCP? Allow or deny? | Logs / events | Server guard audit (`GET /audit`) |
| Same attempt on client and server? | Trace (lightweight) | `trace_id`, `session_id` headers |
| Was the JWT valid? Which scopes? | Logs / events | Server audit fields (`token_scopes`, `required_scope`) |

**Pitch:** MCPToolGuard observability answers *which tools were attempted, with what token, allow or deny, and did the server agree?* For model latency, token usage, and reasoning chains, use your existing APM or LLM platform; ship **server** guard JSON into that stack (Tier 2).

**In scope (this repo)**

- Structured allow/deny per `tools/call`
- Correlation IDs across client SDK → MCP → server
- Dual audit planes in the demo UI (teaching aid)

**Out of scope (0.x demo)**

- WebLLM / chat “thought” tracing
- Token or latency metrics in the browser
- Full OpenTelemetry span trees for every model hop
- Replacing Grafana/Datadog with a custom React dashboard

**Production path ([ROADMAP](ROADMAP.md) Tier 2)**

- Emit server guard decisions to stdout, a file, or OpenTelemetry
- Dashboard in Grafana/Loki/Datadog (or your SIEM)
- Optional later: counters (e.g. `tool_guard_denies_total`), log fields mapped to OTel attributes

## Policy configuration

Keep these aligned (same tool names and `required_scope` values):

| File | Used by |
|------|---------|
| `servers/flight/guard_config.yaml` | Python server guard |
| `gateway/config.yaml` | SDK / tests |
| `ui/src/guard-config.ts` | Browser demo agent |

Example (flight tools):

```yaml
tools:
  search_flights_tool:
    required_scope: flights:read
  cancel_booking_tool:
    required_scope: flights:delete
    alert: true
```

Wildcards: `flights:*` or `*`.

## Demo vs production

Reference demo, not a hosted security product. [ROADMAP 0.3.0](ROADMAP.md#release-030--hardening--multi-server) and [NEXT-STEPS](NEXT-STEPS.md) track hardening; Tier 2 covers IdP, proxy, and observability sinks.

| Concern | Demo (now) | Production (later) |
|---------|------------|---------------------|
| Enforcement | Server on flight MCP + client SDK pre-check | Same pattern on every MCP hop |
| Audit storage | In-memory + UI panel | Log shipper → Loki/Datadog/etc. |
| Dashboards | In-browser sections | Grafana / SIEM |
| Identity | `demo-tokens.json` + public PEM | IdP, JWKS, short-lived tokens |

## Current limitations (demo)

| Limitation | Detail |
|------------|--------|
| Guard | Server enforces every `tools/call`; client pre-check is UX + intent audit only when MCP is public |
| Server audit | In-memory (`GET /audit`); resets on cold start; **unauthenticated** on public deploy; intermittent on Vercel serverless (see [NEXT-STEPS](NEXT-STEPS.md)) |
| CORS | Defaults to demo UI + local Vite; not `*` on flight server (0.2.0+) |
| Policy | Three files must stay aligned (`guard_config.yaml`, `gateway/config.yaml`, `ui/guard-config.ts`) |
| MCP surface | `initialize` / `tools/list` unguarded; no prompts, elicitation, or resources |
| Data | Mock in-memory flights/bookings |
| Multi-server | UI wires **flight** only; yaml stubs for slack/github are future |

## Remote deployment

- **UI** and **flight MCP** on separate HTTPS origins (live: [UI](https://mcp-tool-guard-ui.vercel.app/), [health](https://mcp-tool-guard-flight-server.vercel.app/health)).
- Browser sends `Authorization: Bearer` on every MCP request.
- **Server** must enforce scopes — client-only checks are not sufficient.
- **HTTPS + JWT scopes** for browser → MCP; mTLS optional for service-to-service.

Walkthrough: [vercel-deploy.md](vercel-deploy.md). After deploy: [NEXT-STEPS.md](NEXT-STEPS.md).

## JWT & demo tokens

### Files

| Path | Purpose | Committed? |
|------|---------|------------|
| `keys/demo-private.pem` | Signs demo JWTs | No |
| `ui/public/demo-public.pem` | Verify in browser + server (local/CI) | Yes (public key only) |
| `ui/public/demo-tokens.json` | `read_only`, `booking`, `admin` JWTs | Yes (demo credentials) |

Regenerate: `make keys` or `npm run generate-keys`.

### Token format

- **Algorithm:** RS256
- **Claims:** `sub`, `iat`, `exp`, **`scope`** (space-separated)
- Also accepts `scopes` or `scp` for IdP compatibility

### Demo profiles

| UI key | Scopes | Search | Book | Cancel |
|--------|--------|--------|------|--------|
| `read_only` | `flights:read` | Yes | No | No |
| `admin` | + `flights:write`, `flights:delete` | Yes | Yes | Yes |

(`booking` = read + write, no delete.)

### Enforcement flow (demo)

```
Agent → ToolGuard.authorize (client audit) → mcp.callTool → server middleware (server audit) → tool handler
```

Production: use IdP-issued tokens and JWKS; do not ship private keys or long-lived prod tokens in the repo.

## Security layers

1. **Transport** — HTTPS (mTLS optional service-to-service)
2. **Identity** — JWT bearer
3. **Authorization** — per-tool scope from config
4. **Audit** — structured log (server = record of record)
5. **Alerts** — per tool (e.g. `cancel_booking_tool`)

## What this is not

- Not a SaaS IdP — consumes tokens; demo keys only for local use
- Not a substitute for server enforcement on a public MCP endpoint
- Not cloud-dependent for the LLM — WebLLM runs in the browser
- Not full agent observability — security-relevant **tool gate** events only (see [Observability scope](#observability-scope))

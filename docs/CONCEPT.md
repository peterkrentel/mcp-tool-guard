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
| Identity | `demo-tokens.json` + public PEM (static demo JWTs; no 0.3 rotation) | IdP, JWKS, short-lived tokens |

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
| Demo tokens | Static 365-day JWTs in `ui/public/demo-tokens.json` — demo only; **Tier 2 IdP** replaces (no 0.3 rotation) |

## Remote deployment

- **UI** and **flight MCP** on separate HTTPS origins (live: [UI](https://mcp-tool-guard-ui.vercel.app/), [health](https://mcp-tool-guard-flight-server.vercel.app/health)).
- Browser sends `Authorization: Bearer` on every MCP request.
- **Server** must enforce scopes — client-only checks are not sufficient.
- **HTTPS + JWT scopes** for browser → MCP; mTLS optional for service-to-service.

Walkthrough: [vercel-deploy.md](vercel-deploy.md). After deploy: [NEXT-STEPS.md](NEXT-STEPS.md).

This is **remote MCP you own** (your flight server on Vercel). For MCP hosts you **do not** control, see [Third-party / unowned MCP](#third-party--unowned-mcp).

## Third-party / unowned MCP

Agents often call MCP tools on **someone else’s origin** (e.g. Slack, GitHub, a partner API). MCPToolGuard’s job is **scoped protection** and **audit** for those calls too — but **where** enforcement and logging run depends on who operates the server.

### Two meanings of “remote”

| Kind | Example | Who runs the MCP | What 0.2.0 proves |
|------|---------|------------------|-------------------|
| **Remote, yours** | Flight on Vercel | You | Server guard + `GET /audit` on **your** deploy |
| **Remote, unowned** | `https://mcp.vendor.com/mcp` | Vendor | Client SDK only until you add a **guard proxy** |

“Remote” in [vercel-deploy.md](vercel-deploy.md) means the first row. This section is the second.

### What you can get without owning the MCP

| Goal | Client `ToolGuard` (SDK) | Your flight server + KV | Guard HTTP proxy (Tier 2) |
|------|--------------------------|-------------------------|---------------------------|
| Scope check before `tools/call` | Yes — pre-check | N/A (traffic doesn’t hit flight) | Yes — **authoritative** |
| Audit **agent attempts** (intent) | Yes — browser / agent log | No | Yes — client + server |
| **Authoritative** allow/deny on vendor URL | No — bypassable | No | Yes — proxy enforces |
| **Authoritative** audit of calls to vendor | No | No | Yes — proxy log → KV / Loki / OTel |
| Works if user bypasses your UI | No | No | Yes — if agent only talks to proxy |

**Client-only** (SDK + multi-server UI, [ROADMAP 0.3 #8](ROADMAP.md#release-030--hardening--multi-server)): honest agents, UX, and intent audit — **not** tamper-proof security on a public vendor endpoint.

**Authoritative** protection and audit for unowned MCP: traffic must pass **infrastructure you run** — same middleware pattern as flight, forwarding allowed `tools/call` upstream with service credentials.

### Architecture: owned vs unowned

**Owned MCP (demo today)**

```
Browser → ToolGuard (client) → your flight MCP → guard middleware → tool handler
                                      ↑
                              GET /audit (KV in 0.3 #4)
```

**Unowned MCP — client-only (0.3 multi-server, not security-grade)**

```
Browser → ToolGuard (client) ──→ vendor MCP
              ↑
        Agent attempts audit only
```

**Unowned MCP — production shape (Tier 2 guard proxy)**

```
Browser → ToolGuard (client) → YOUR guard proxy → vendor MCP
              │                        ↑
        Agent attempts          enforce JWT + scopes
                                authoritative audit → KV / Loki / OTel
```

Policy for both flight and upstream tools can live in one `gateway/config.yaml` (server aliases + URLs). The proxy applies the same scope rules as [flight `guard_middleware`](../servers/flight/guard_middleware.py); KV (or an observability sink) stores **proxy** decisions — not vendor-side memory.

### KV and audit storage

| Store | Applies to |
|-------|------------|
| In-memory / **Vercel KV** on flight | Audit for `tools/call` that hit **your** flight server |
| KV / log sink on **guard proxy** | Authoritative audit when forwarding to **unowned** MCP |
| Client `AuditLogger` | Intent for any URL the agent calls — not compliance evidence |

KV does **not** create a shared log across arbitrary third-party hosts. It makes **your** enforcement hop’s audit durable on serverless.

### Roadmap alignment

| Work | Delivers |
|------|----------|
| [0.3 #8–9](ROADMAP.md#release-030--hardening--multi-server) | Client routing + policy for multiple `servers.*.url`; optional second **mock** you own |
| [0.3 #4](ROADMAP.md#release-030--hardening--multi-server) | Reliable `/audit` for **flight** on Vercel |
| [Tier 2 #11 — Guard HTTP proxy](ROADMAP.md#tier-2--product-depth-post-03) | Authoritative scope + audit for **unowned** upstream MCP |
| [Tier 2 observability sink](ROADMAP.md#tier-2--product-depth-post-03) | Production dashboards (Grafana/Loki) instead of demo UI panel |

Do **not** point the demo UI at real vendor MCP URLs without a proxy — see [NEXT-STEPS](NEXT-STEPS.md#phase-d--multi-server-client-1-2-prs).

## JWT & demo tokens

### Files

| Path | Purpose | Committed? |
|------|---------|------------|
| `keys/demo-private.pem` | Signs demo JWTs | No |
| `ui/public/demo-public.pem` | Verify in browser + server (local/CI) | Yes (public key only) |
| `ui/public/demo-tokens.json` | `read_only`, `booking`, `admin` JWTs | Yes (demo credentials) |

Regenerate: `make keys` or `npm run generate-keys`. Demo JWTs are static (365-day `exp`) until **Tier 2 IdP** — no 0.3 token-rotation work; see [NEXT-STEPS → Demo tokens](NEXT-STEPS.md#demo-tokens--no-03-work).

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

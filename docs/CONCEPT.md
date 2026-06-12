# MCPToolGuard — Concept

**Navigation:** [Architecture](ARCHITECTURE.md) · [Quick start](../README.md) · [Live demo](vercel-deploy.md#live-demo) · [Vercel deploy](vercel-deploy.md) · [Next steps](NEXT-STEPS.md) · [Cursor guide](cursor-guide.md) · [Roadmap](ROADMAP.md) · [Changelog](../CHANGELOG.md)

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

### Proof vs presentation {#proof-vs-presentation}

What you **sell** is proxy enforcement + audit replay, not chat quality or model choice.

| Layer | Role | Required to prove the product? |
|-------|------|--------------------------------|
| **Proxy + `GET /audit`** | Truth — enforcement decision + durable record | **Yes** — [demo-proxy.md](demo-proxy.md) |
| **Client `ToolGuard`** | Pre-check + agent-attempt log (intent) | Optional — teaches dual-plane model |
| **UI / WebLLM / LLM picker** | Human visualization | Optional — not authoritative |

Canonical demo: one scoped JWT, one denied `tools/call`, one `/audit` query with matching `trace_id`. Build filter for new work: [ROADMAP → Build filter](ROADMAP.md#build-filter).

## Scopes, roles, and identity

**Admins assign scope rights; MCPToolGuard enforces them per tool.** The guard does not manage users or groups — your IdP does. At `tools/call` the guard only asks: *does this Bearer token include the scope required for this tool?*

### Two layers (do not mix them)

| Layer | Owner | Question |
|-------|--------|----------|
| **Identity** | Auth0, Keycloak, Azure AD, … | Who is this principal? Which **roles/groups** do they have? What **scopes** go on the access token? |
| **MCPToolGuard** | `gateway/config.yaml` + server/proxy guard | For **server + tool**, what **`required_scope`** applies? Does the token satisfy it? |

Policy maps **tools** to **scope strings** (e.g. `publish_document_tool` → `docs:write`), not “access to MCP server X.” Namespace prefixes (`flights:`, `docs:`, `slack:`) usually align with MCP domains, but the enforceable unit is the **scope**, not the server URL.

### One token, many MCP servers

A single access token carries a flat list of scopes (`scope` claim and/or Auth0 `permissions`). The same token can call **flight**, **documents**, and (via proxy #12) vendor MCP — each tool still checks its own required scope.

Wildcards: `flights:*`, `docs:*`, or `*` match any scope in that resource ([gateway/guard.ts](../gateway/guard.ts)).

### Roles and groups (scale in the IdP)

Direct **user → scope** assignments work for demos; production should use **roles or groups → scopes**:

```
Role: flight-readers   →  flights:read, docs:read
Role: kb-editors       →  docs:read, docs:write
Role: platform-admin   →  flights:*, docs:*
```

Assign users to roles in the IdP; token issuance **flattens** roles into `permissions` / `scope`. MCPToolGuard never needs a “group” claim — only the resulting scope list.

The guest JWT dropdown (`read_only` / `booking` / `admin`) is a **toy role bundle** minted in [`generate-keys.mjs`](../scripts/generate-keys.mjs). Auth0 uses the same idea with API permissions and optional Roles.

Details: [identity.md → Scopes vs roles](identity.md#scopes-vs-roles-how-admins-grant-access).

## Architecture

**Diagrams and component map:** [ARCHITECTURE.md](ARCHITECTURE.md) (system context, sequence per turn, policy, IdP, today vs proxy).

```
Browser tab (Vite + WebLLM)
├── WebLLM              ← local LLM (not the MCP caller)
├── Agent loop          ← ui/src/agent.ts
├── Agent trace         ← ui/src/agent-trace.ts — routing + model preview per turn
├── ToolGuard (SDK)     ← gateway/guard.ts — pre-check + agent-attempt log
└── MCP HTTP client     ← ui/src/mcp-client.ts (Bearer JWT, X-Trace-Id)
         │
         │  HTTP / HTTPS
         ▼
Flight MCP server       ← servers/flight/ — guard middleware on tools/call (demo embedded guard)
```

The **MCP caller** is `mcp-client.ts`, not WebLLM. WebLLM proposes tool JSON; the agent runs `ToolGuard.authorize`, then `tools/call` when allowed.

### Three audit planes (demo UI)

Full diagrams: [ARCHITECTURE.md](ARCHITECTURE.md#three-observability-planes-demo-ui).

| Plane | Source | Question | Trust |
|-------|--------|----------|-------|
| **Agent trace** | `ui/src/agent-trace.ts` | Heuristic vs LLM? Model preview? Outcome before/after guard? | Debug only |
| **Agent attempts** | `ToolGuard` in browser | Which tool and scopes? Client pre-check allow/deny? | Debug only |
| **Server enforcement** | `GET /audit` on flight | What reached MCP? JWT valid? Final allow/deny? | **Authoritative** |

Correlate with `trace_id` across all three (click a trace id in the audit panel). **No server row after a client deny is expected** — the attempt still appears under Agent trace and Agent attempts.

For compliance and production dashboards, use **server** guard JSON (Tier 2 → Grafana/Loki), not the browser log.

## Observability scope

Agent observability often spans **metrics** (latency, tokens, error rates), **traces** (step-by-step model and tool calls), and **logs/events** (discrete decisions and failures). MCPToolGuard focuses on the **tool boundary** — not a full “glass box” for the LLM.

**What we answer**

| Question | Signal type | How |
|----------|-------------|-----|
| Which tool did the agent try? | Logs / events | Client agent-attempt audit |
| How was the turn routed (heuristic vs LLM)? | Logs / events | Agent trace panel (demo UI) |
| Did it reach MCP? Allow or deny? | Logs / events | Server guard audit (`GET /audit`) |
| Same attempt on client and server? | Trace (lightweight) | `trace_id`, `session_id` headers |
| Was the JWT valid? Which scopes? | Logs / events | Server audit fields (`token_scopes`, `required_scope`) |

**Pitch:** MCPToolGuard observability answers *which tools were attempted, with what token, allow or deny, and did the server agree?* For model latency, token usage, and reasoning chains, use your existing APM or LLM platform; ship **server** guard JSON into that stack (Tier 2).

**In scope (this repo)**

- Structured allow/deny per `tools/call`
- Correlation IDs across client SDK → MCP → server
- Three audit sections in the demo UI (agent trace, agent attempts, server — teaching aid)

**Out of scope (0.x demo)**

- Full LLM platform observability (token/latency dashboards, prompt registry)
- Full OpenTelemetry span trees for every model hop
- Replacing Grafana/Datadog with a custom production dashboard

**Production path ([ROADMAP](ROADMAP.md) Tier 2)**

- Emit server guard decisions to stdout, a file, or OpenTelemetry
- Dashboard in Grafana/Loki/Datadog (or your SIEM)
- Optional later: counters (e.g. `tool_guard_denies_total`), log fields mapped to OTel attributes

## Policy configuration

**Canonical:** [`gateway/config.yaml`](../gateway/config.yaml) — per-server `url` + `tools` → `required_scope` (guard / proxy; vendor MCP never reads this file).

| File | Used by |
|------|---------|
| `gateway/config.yaml` | Client `ToolGuard` (UI imports at build), **guard proxy** (#12) on Render |
| `servers/flight/guard_config.yaml` | **Demo only** — embedded guard on flight MCP until proxy; must match `servers.flight` in gateway yaml (CI: `npm run check:demo-policy`) |
| `ui/src/guard-config.ts` | Imports gateway yaml + demo `TOOL_DESCRIPTIONS` (LLM hints, not policy) |

Example (flight tools in gateway config):

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
| Identity | `demo-tokens.json` + public PEM (transitional) | **Auth0 / OIDC** — [identity.md](identity.md), [auth0-setup.md](auth0-setup.md) |

## Current limitations (demo)

| Limitation | Detail |
|------------|--------|
| Guard | Server enforces every `tools/call`; client pre-check is UX + intent audit only when MCP is public |
| Server audit | In-memory (`GET /audit`); resets on cold start; **unauthenticated** on public deploy; intermittent on Vercel serverless (see [NEXT-STEPS](NEXT-STEPS.md)) |
| CORS | Defaults to demo UI + local Vite; not `*` on flight server (0.2.0+) |
| Policy | One canonical yaml; flight `guard_config.yaml` is temporary demo scaffolding |
| MCP surface | `initialize` / `tools/list` unguarded; no prompts, elicitation, or resources |
| Data | Mock in-memory flights/bookings |
| Multi-server | `/` flight chat only; `/agents.html` routes per selected agent (`/github/mcp`, …) |
| Demo tokens | Guest JWTs in repo + Auth0 login — [identity.md](identity.md#guest-demo-existing-jwts--auth0) |

## Remote deployment

- **UI** and **flight MCP** on separate HTTPS origins (live: [UI](https://mcp-tool-guard-ui.vercel.app/), [health](https://mcp-tool-guard-flight-server.vercel.app/health)).
- Browser sends `Authorization: Bearer` on every MCP request.
- **Server** must enforce scopes — client-only checks are not sufficient.
- **HTTPS + JWT scopes** for browser → MCP; mTLS optional for service-to-service.

Walkthrough: [vercel-deploy.md](vercel-deploy.md). After deploy: [NEXT-STEPS.md](NEXT-STEPS.md).

This is **remote MCP you own** (your flight server on Vercel). For MCP hosts you **do not** control, see [Third-party / unowned MCP](#third-party--unowned-mcp).

## Third-party / unowned MCP

Agents often call MCP tools on **someone else’s origin** (e.g. Slack, GitHub). Scoped protection and audit depend on **who runs the server**.

### Two meanings of “remote”

| Kind | Example | Who runs MCP |
|------|---------|--------------|
| **Remote, yours** | Flight on Vercel | You — server guard + `/audit` |
| **Remote, unowned** | Vendor MCP URL | Vendor — **guard proxy** on Render enforces; wire vendor URL in `config.prod.yaml` |

### Capability by deployment

| Goal | Client SDK | Your flight + KV | Guard proxy (Tier 2) |
|------|------------|------------------|----------------------|
| Scope pre-check | Yes | N/A | Yes — authoritative |
| Authoritative enforce on vendor | No | No | Yes |
| Authoritative audit | No | Your flight only | Yes — proxy log |

**Client-only** multi-server ([ROADMAP #9](ROADMAP.md#release-030--hardening--multi-server)) = intent audit, not tamper-proof. **KV** on flight does not audit vendor MCP — see [identity.md](identity.md).

**Implementation order:** [cursor-guide.md](cursor-guide.md) — **Track 1** KV registry (**done**), **Track 2** GitHub MCP + `upstream_token` (**done** — [track2-github-proof.md](track2-github-proof.md)), **Track 3** approval queue for on-demand scope. KV key sketches: [kv-design.md](kv-design.md).

```
Unowned MCP (production):  Browser → YOUR guard proxy → vendor MCP
                                    ↑ JWKS + scopes + audit (KV/Loki)
```

## Identity & IdP

Product pitch: **bring your IdP** — we validate JWT scopes at `tools/call`.

| Topic | Doc |
|-------|-----|
| Auth0 vs Keycloak, Path A vs audit secret | [identity.md](identity.md) |
| Auth0 dashboard checklist | [auth0-setup.md](auth0-setup.md) |
| Env template | [auth0-env.example](auth0-env.example) |

**0.3:** Auth0 login **or guest demo** (existing JWTs); dual verify on flight; `/audit` requires Bearer from either path.

### Guest vs signed-in

| | Guest | Auth0 |
|--|-------|-------|
| UX | Scope dropdown (today) | Login button |
| Token | `demo-tokens.json` | Access token |
| Verify | Demo PEM | JWKS + iss/aud |

Details: [identity.md → Guest demo](identity.md#guest-demo-existing-jwts--auth0).

## JWT & demo tokens

### Files

| Path | Purpose | Committed? |
|------|---------|------------|
| `keys/demo-private.pem` | Signs demo JWTs | No |
| `ui/public/demo-public.pem` | Verify in browser + server (local/CI) | Yes (public key only) |
| `ui/public/demo-tokens.json` | `read_only`, `booking`, `admin` JWTs | Yes (demo credentials) |

Regenerate: `make keys` or `npm run generate-keys`. **Guest mode** keeps these JWTs on the public demo; **Auth0** is optional login ([identity → Guest](identity.md#guest-demo-existing-jwts--auth0)).

### Token format

- **Algorithm:** RS256
- **Claims:** `sub`, `iat`, `exp`, **`scope`** (space-separated)
- Also accepts `scopes` or `scp` for IdP compatibility

### Demo profiles (guest dropdown = role bundles)

| UI key | Scopes (guest JWT) | Search | Book | Cancel |
|--------|-------------------|--------|------|--------|
| `read_only` | `flights:read` | Yes | No | No |
| `booking` | + `flights:write` | Yes | Yes | No |
| `admin` | + `flights:delete` | Yes | Yes | Yes |

Additional domains (e.g. `docs:read`) use the same pattern when `gateway/config.yaml` adds servers — assign via IdP roles, not per MCP URL. See [auth0-setup.md](auth0-setup.md).

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

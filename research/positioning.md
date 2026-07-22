# Where `mcp-tool-guard` Actually Sits

Analysis, not fact — this is the "pontificating" file. Read [`tool-authorization-landscape-2026.md`](tool-authorization-landscape-2026.md)
first for the cited external grounding; this file is opinion built on top of it, checked against
this project's own code.

> Every claim below about this project's own behavior (not the external market/spec claims) has
> been verified line-by-line against `gateway/*.ts`, `servers/flight/guard.py`,
> `servers/flight/guard_middleware.py`, and the relevant `docs/*.md` files. Where the first draft
> of this file overclaimed or omitted a caveat, that's noted explicitly below rather than silently
> fixed — the corrections are as informative as the claims.

## What this project actually demonstrates

1. **An agent gets its own identity with its own scopes** — confirmed. Auth0 M2M clients are
   persisted with their own `scopes` (`gateway/agent-store.ts`), and every check reads scope from
   the live JWT, not from anything pinned at agent-creation time.
2. **Authorization happens at call time**, against the specific tool being invoked — confirmed.
   `checkScope`/`authorize` (`gateway/guard.ts`) run fresh on every `tools/call`, called per-request
   from both the TS proxy (`gateway/proxy-routes-mcp.ts`) and the flight demo server's own
   middleware (`servers/flight/guard_middleware.py`).
3. **High-impact actions can be held for a human decision** — real, but **opt-in and one-sided**.
   The pending-approval mechanism (`gateway/pending-store.ts`) is a genuine third state (not just
   allow/deny — see `GuardDecision` in `gateway/types.ts`), with a real create → wait → resolve flow
   and single-use approval/poll tokens. But it only activates when `MCP_APPROVAL_QUEUE=true` is set;
   unset (the default), a scope mismatch skips straight to a hard deny
   (`gateway/proxy-routes-mcp.ts`, confirmed in `docs/CONCEPT.md`). And it exists **only** in the TS
   proxy — the flight server's embedded guard has no approval-queue concept at all; it can only
   allow or return a hard JSON-RPC error.
4. **Every decision is logged with a correlating trace ID** — true, but narrower than it sounds.
   The `trace_id` is a shared *string value* threaded across three **independently-owned** audit
   stores (the TS proxy's, the flight server's own separate KV/audit store, and a client-submitted
   "agent" log) — not a single unified trace. The flight server's audit rows are not part of the
   OpenTelemetry span tree described below; `docs/otel.md` says as much directly. And the *agent*
   layer of that correlation is self-reported by the browser client and, depending on config, not
   independently verified — see the "thinner" section below.
5. **M2M agent revocation is checked on every call, not just at token mint** *(confirmed this
   session, not in the original draft)*. `guard.ts`'s `assertActiveM2mAgent` runs inside
   `validateToken`, called on every `authorize()`. It's wired up whenever `m2mRevocationEnabled()`
   is true, which defaults to `kvEnabled()` — true in every real deployment (KV persistence is how
   the proxy stores agents/audit/pending state at all), false only in a bare local session with no
   Upstash configured. The check itself is a single local KV `GET`, not a live Auth0 API round
   trip — cheap enough to run unconditionally.
6. **Real distributed tracing, not just log lines** *(confirmed this session)*. `gateway/telemetry.ts`
   emits actual OpenTelemetry spans per `tools/call` decision (tool, server, decision, scopes,
   trace_id, approval method as attributes), nests the allow-path span as a parent of the upstream
   forward call, and bridges `console.*` output into OTel logs — all genuinely first-class, safely
   no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, and a documented real deploy path
   (`docs/render-deploy.md`). Whether the live Render deployment currently has a collector endpoint
   configured isn't something code can confirm — that's a dashboard setting, not a code fact.

## Where the market has already caught up

The research surfaced one direct structural peer: **Kong AI Gateway's MCP Tool ACLs (3.13) plus
OAuth2 scope-based tool filtering (3.14)** does the same core thing — gate individual MCP tool
calls based on scopes in an incoming token — as a shipped, supported product. **LiteLLM's Tool
Permission Guardrail** covers similar ground with regex-based rules, open-source and self-hostable.

That matters for honest positioning: "a gateway that scopes MCP tool calls" is not a gap in the
market anymore, if it ever fully was. What's more defensibly a gap:

- Most "AI gateway" products (Cloudflare AI Gateway, Portkey, and similar) still market
  authorization but ship **observability and coarse-grained (team/user-level) access**, not the
  per-request scope intersection OWASP's framework describes.
- The **human-in-the-loop pending-approval queue** as a first-class middle state is less commonly
  a headline feature in the gateway products surveyed — though within this project it's currently
  a TS-proxy-only, opt-in feature, not something implemented uniformly across every enforcement
  point (see below).
- A **compact, readable reference implementation** you can point at to explain the whole pattern
  in one sitting is genuinely rarer than the pattern itself.

## Where the current implementation is thinner than the "converged" pattern

- **No intersection logic — confirmed, not hypothetical.** OWASP's framing is effective permission
  = intersection of (user scope, agent scope, tool requirements). `checkScope`
  (`gateway/guard.ts`) takes exactly **one** permission set — `tokenScopes: string[]` — and compares
  it 1:1 against the tool's `required_scope`. `JwtPayload` (`gateway/types.ts`) has no separate
  "user scope" field anywhere; `scope`/`scopes`/`scp`/`permissions` are all read from the *same*
  token and merged into one array. The flight server's Python guard mirrors this exactly. There is
  no second permission set consulted at call time, in either language.
- **Tokens are long-lived and cached, not JIT — confirmed, and the opposite of what I assumed
  going in.** `gateway/token-vendor.ts`'s `vend()` explicitly caches a token per `clientId` and
  reuses it across every call until ~60 seconds before the IdP's own expiry. That's standard OAuth
  client-credentials caching — reasonable — but it is structurally the opposite of a just-in-time,
  per-task token, and there's no `jti`/nonce/single-use mechanism anywhere in this codebase (grepped
  for it — nothing). If ephemeral tokens matter to the threat model, this is a real, deliberate gap
  to revisit, not a detail to double-check.
- **Agent identity is "an OAuth client," not a distinct principal type.** The persisted agent
  record (`gateway/agent-store.ts`) is exactly an Auth0 M2M client with scopes and a KV
  `status: "active"` flag. No SPIFFE-style identity, no separate agent-principal lifecycle beyond
  that flag. Reasonable for this project's scale — just not the leading-edge model.
- **Transitive scope composition** (tool A triggers tool B triggers tool C) — there's no code path
  in this repo to even evaluate this against; the flight demo's tools are all leaf handlers with no
  outbound calls to other tools. Genuinely open, not yet a live gap.
- **The two "authoritative" enforcement layers are not functionally equivalent** *(a real gap
  neither draft of this file named)*. The TS proxy and the flight server's embedded middleware
  enforce the *same scope policy* (kept aligned by a CI check, not at runtime) — but the flight
  guard has **no equivalent of the M2M revocation check** and **no approval-queue concept**. In the
  demo topology this is moot in practice because flight is only ever reached through the proxy, but
  that protection comes from network topology, not from the flight guard's own logic. If flight
  were ever reachable directly, a revoked agent's still-unexpired token would pass there.
- **"Every decision is logged" glosses over trust asymmetry between log sources.** The proxy's and
  flight's audit rows are server-generated and authoritative. The "agent" observability layer's rows
  are submitted by the (untrusted) browser client and, depending on config
  (`MCP_AUDIT_AGENT_TRUSTED_MODE`, or guard disabled entirely), can be accepted without independently
  verifying their content. Any future claim about audit completeness should distinguish
  "authoritative" rows from "self-reported" ones rather than treating all three sources as equally
  trustworthy.
- **A global kill switch exists.** `MCP_GUARD_ENABLED=false` disables enforcement in both the proxy
  and the flight guard at once, for local dev, with a runtime warning. Deliberate and documented,
  not a bug — but worth naming explicitly in any discussion of single points of failure, since it
  is exactly that: one flag that turns off every enforcement point simultaneously.

**Worth crediting, found but not previously mentioned in this file:**

- **Layered rate limiting** — an in-memory sliding window plus a KV-backed distributed fixed-window
  limiter (`gateway/proxy-server.ts`). Real operational hardening, independent of the scope-check
  logic above.
- **Dual-trust JWT verification** — both the TS and Python guards verify via JWKS when the token's
  issuer matches the configured Auth0 tenant, and fall back to PEM-only verification otherwise (the
  demo-guest-key path). Deliberate, documented (`docs/identity.md`) — worth naming when discussing
  how uniformly tokens are actually verified across the two enforcement points.

## Avenues worth pursuing next, roughly in priority order

1. **Decide, and document, what to do about the proxy/flight asymmetry.** Right now flight's
   protection from a revoked agent or an unapproved high-risk call depends entirely on it only
   being reachable through the proxy. Either that's an accepted, explicitly-stated limitation of a
   demo-only server, or it's a gap worth closing — but it shouldn't stay implicit.
2. **Decide whether true intersection-based authorization is in scope.** The code confirms
   single-layer checking today. That may be entirely fine for this project's current threat model
   — but it should be a stated decision, not an assumption inherited from not having looked yet.
3. **Revisit token lifetime deliberately if ephemeral/JIT tokens matter.** Today's caching behavior
   is a design choice, not an oversight — but it's worth being explicit about whether that choice
   still holds as the threat model gets more specific.
4. **Tighten the audit-trust story.** Either surface self-reported (agent-layer) rows differently
   from server-generated ones in whatever consumes the audit trail, or stop describing "every
   decision is logged" without that distinction.
5. **Read Kong's MCP Tool ACL / OAuth2 scope-filtering docs in detail** as the closest real-world
   analog — a precise "here's how this differs from Kong" beats a vague one.
6. **Leave agent-identity-as-principal-type (SPIFFE / Entra Agent ID) as a watch item**, not a
   near-term build target — it's the bleeding edge, not yet the baseline, and adopting it before
   this project needs it would be solving a problem it doesn't have yet.

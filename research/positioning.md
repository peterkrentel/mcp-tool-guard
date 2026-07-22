# Where `mcp-tool-guard` Actually Sits

Analysis, not fact — this is the "pontificating" file. Read [`tool-authorization-landscape-2026.md`](tool-authorization-landscape-2026.md)
first for the cited external grounding; this file is opinion built on top of it, checked against
this project's own code.

> Every claim below about this project's own behavior (not the external market/spec claims) has
> been verified line-by-line against `gateway/*.ts`, `servers/flight/guard.py`,
> `servers/flight/guard_middleware.py`, and the relevant `docs/*.md` files. An earlier pass through
> this file flagged a few things as "gaps" that turned out, on closer inspection, to be either
> deliberate fail-closed design or an artifact of build order rather than an oversight — those
> corrections are kept visible below rather than silently smoothed over, because getting the
> calibration wrong the first time is itself informative.

## What this project actually demonstrates

1. **Config-based default-deny, before scope is even checked.** `gateway/config.yaml` defines
   exactly which tools exist per server and what scope each requires. A tool with no config entry
   isn't "unscoped" — it's unreachable: `checkScope` (`gateway/guard.ts:242-256`) hard-denies it
   before ever inspecting the token. Scope isn't granted to "all MCP tools" by default; the config
   is the allowlist.
2. **An agent gets its own identity with its own scopes** — an Auth0 M2M client, persisted with its
   own `scopes` (`gateway/agent-store.ts`), read fresh from the live JWT on every call.
3. **A third credential layer separates the agent's identity from the upstream MCP server's.**
   `gateway/proxy-routes-mcp.ts:35-43` (`buildReqHeadersWithUpstreamAuth`) **replaces** the agent's
   Authorization header with the proxy's own static `upstream_token` before forwarding to the real
   MCP server, when one is configured. The agent's own identity is checked *at the proxy* and never
   reaches the upstream tool at all — only the proxy's own service credential does. That's a real
   credential-vaulting pattern: three distinct credentials in play (agent → proxy, proxy → upstream
   server, and the one-time human-approval token below), not one token doing everything.
4. **Authorization happens at call time**, against the specific tool being invoked — `checkScope`/
   `authorize` (`gateway/guard.ts`) run fresh on every `tools/call`, from both the TS proxy and the
   flight demo server's own middleware.
5. **A one-time, opaque, human-in-the-loop grant for calls that fail scope.** When a call is denied
   by scope, it can be escalated to a human via `gateway/pending-store.ts`'s pending-request flow. The
   resulting **approval token** (`at_...`) is genuinely opaque (a random ID, not a JWT — no decodable
   claims) and genuinely single-use (`validateApprovalToken` deletes its KV record on first successful
   use — "burn on first use," `pending-store.ts:196-218`). This activates only via
   `MCP_APPROVAL_QUEUE=true`; unset, a scope failure hard-denies immediately instead — a deliberate
   fail-closed default, not a shortcoming.
6. **M2M agent revocation is checked on every call, not just at token mint.** `guard.ts`'s
   `assertActiveM2mAgent` runs inside `validateToken`, wired up whenever `m2mRevocationEnabled()` is
   true — which defaults to `kvEnabled()`, true in every real deployment. The check is a single local
   KV lookup, not a live Auth0 API round trip.
7. **Real distributed tracing, not just log lines.** `gateway/telemetry.ts` emits actual OpenTelemetry
   spans per decision, nests the allow-path span as a parent of the upstream forward call, bridges
   console output into OTel logs, and is a safe no-op when unconfigured.

## Where the market has already caught up

The research surfaced one direct structural peer: **Kong AI Gateway's MCP Tool ACLs (3.13) plus
OAuth2 scope-based tool filtering (3.14)** does the same core thing — gate individual MCP tool
calls based on scopes in an incoming token — as a shipped, supported product. **LiteLLM's Tool
Permission Guardrail** covers similar ground with regex-based rules, open-source and self-hostable.

"A gateway that scopes MCP tool calls" is not an open gap in the market, if it ever fully was. What
looks more defensibly differentiated:

- Most "AI gateway" products (Cloudflare AI Gateway, Portkey, and similar) still market
  authorization but ship observability and coarse-grained (team/user-level) access, not per-request
  scope enforcement.
- The **one-time opaque approval-token escalation flow**, layered on top of a separate credential
  boundary between agent and upstream server, is a more specific and more complete pattern than a
  generic "human-in-the-loop" feature flag — it's less commonly a headline feature elsewhere.
- A **compact, readable reference implementation** of all three credential layers together is
  genuinely rarer than any one piece of the pattern alone.

## Things previously flagged here as "gaps" that, on reflection, aren't

Keeping these visible rather than deleting them, because the miscalibration is worth remembering:

- **"No three-way (user × agent × tool) scope intersection."** True as a fact about the code — but
  OWASP's intersection principle targets *user-delegated* agents, where a human logs in and the
  agent should be constrained to what that specific human can see. This project's agents are
  **service agents**: there's no separate human user in the request path to intersect against — the
  M2M client's own granted scope already *is* the authorization ceiling. That's a different, valid
  pattern, not a thinner version of the same one. It would become a real gap only if a
  user-delegated agent pattern gets added later.
- **"The approval queue is opt-in, not unconditional."** Still true, but framing it as a weakness was
  wrong — defaulting to hard-deny unless human-escalation is explicitly turned on is the correct
  fail-closed choice, not a shortcoming.
- **"Tokens are cached and reused, not JIT/single-use."** Still true of the agent's own JWT — but
  that's standard OAuth client-credentials behavior, not an oversight. It's only worth revisiting if
  a threat model specifically calls for per-task ephemeral tokens (and note the *approval* token
  already is single-use, where single-use actually matters — a one-time human grant).

## Where a real, narrower gap remains

**The two "authoritative" enforcement layers are not functionally equivalent** — and this is where
history matters. `servers/flight/` was the **original proof-of-concept**, built before the TS proxy
existed at all; the M2M revocation check and the approval-token escalation flow were added later,
to the proxy only, and never backported to flight's embedded guard
(`servers/flight/guard.py`/`guard_middleware.py`). So the asymmetry isn't an unexplained design gap —
it's an artifact of build order: flight is the first iteration of the experiment, and the two
newer capabilities simply came after it. In the current demo topology this is low-risk because
flight is only ever reached through the proxy, so it inherits protection from network placement even
though its own logic doesn't implement those two checks. Worth an explicit decision (backport, or
accept flight stays demo-only and frozen at POC-era capability) rather than leaving it implicit —
but it's a "what do we do with the first iteration" question, not a flaw in the current design.

**Also still real and unrelated to the above:** the "agent" observability layer's audit rows are
self-reported by the browser client and, depending on config, not independently verified — distinct
from the proxy's and flight's own server-generated audit rows, which are authoritative. And a global
`MCP_GUARD_ENABLED=false` kill switch disables both enforcement points at once, for local dev —
deliberate and documented, but worth naming in any single-point-of-failure discussion.

**Worth crediting, found but easy to overlook:** layered rate limiting (in-memory sliding window +
KV-backed distributed fixed-window, `gateway/proxy-server.ts`), and dual-trust JWT verification
(JWKS-or-PEM fallback by issuer, in both the TS and Python guards) — deliberate support for both
Auth0-issued and demo-PEM-signed tokens.

## Avenues worth pursuing next, roughly in priority order

1. **Decide what to do with flight as the original POC** — backport the revocation check and
   approval-token flow so both enforcement layers are equivalent, or explicitly freeze flight as a
   demo-only artifact that intentionally doesn't get new proxy-side capabilities. Either is fine;
   leaving it undecided isn't.
2. **Tighten the audit-trust story** — distinguish self-reported (agent-layer) rows from
   server-generated (proxy/flight) ones wherever the audit trail is presented or described.
3. **Read Kong's MCP Tool ACL / OAuth2 scope-filtering docs in detail** as the closest real-world
   analog — a precise "here's how this differs from Kong" beats a vague one.
4. **Revisit token lifetime only if a user-delegated agent pattern or a stricter threat model shows
   up later** — today's cached-JWT-plus-single-use-approval-token split is already correct for a
   service-agent design; don't build ephemeral agent tokens speculatively.
5. **Leave agent-identity-as-principal-type (SPIFFE / Entra Agent ID) and three-way scope
   intersection as watch items**, not near-term build targets — both are real trends, but they solve
   a user-delegated-agent problem this project doesn't currently have.

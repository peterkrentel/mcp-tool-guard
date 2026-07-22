# Where `mcp-tool-guard` Actually Sits

Analysis, not fact — this is the "pontificating" file. Read [`tool-authorization-landscape-2026.md`](tool-authorization-landscape-2026.md)
first for the cited grounding; this file is opinion built on top of it.

## What this project actually demonstrates

Stripped down, `mcp-tool-guard` is one worked example of a pattern the research shows the whole
enterprise-identity world (NIST's AI RMF Agentic Profile, Auth0/Okta's Auth for GenAI, Microsoft's
agent-identity guidance, Google's Agent Gateway) is converging on independently:

1. An agent gets its **own identity** with its own scopes — not a blank check to act as the human.
2. Authorization happens **at call time**, against the specific tool being invoked — not once at
   agent-creation time.
3. High-impact actions can be **held for a human decision** rather than allowed or denied outright.
4. Every decision is **logged with a correlating trace ID** across the layers that touched it.

That's a real, coherent architecture — it's just not a novel one. The value of `mcp-tool-guard` is
that it's a small, legible, end-to-end reference implementation of a pattern that's usually only
visible inside much larger commercial platforms. That's worth something (as a way to *understand*
the pattern, demo it, or bootstrap a much smaller deployment), but it's a different kind of value
than "solves a problem nobody else solves."

## Where the market has already caught up

The research surfaced one direct structural peer: **Kong AI Gateway's MCP Tool ACLs (3.13) plus
OAuth2 scope-based tool filtering (3.14)** does the same core thing — gate individual MCP tool
calls based on scopes in an incoming token — as a shipped, supported product. **LiteLLM's Tool
Permission Guardrail** covers similar ground with regex-based rules, open-source and self-hostable.

That matters for honest positioning: "a gateway that scopes MCP tool calls" is not a gap in the
market anymore, if it ever fully was. What's more defensibly a gap:

- Most "AI gateway" products (Cloudflare AI Gateway, Portkey, and similar) still market
  authorization but ship **observability and coarse-grained (team/user-level) access**, not the
  per-request scope intersection OWASP's framework describes. The gap between marketing and
  actual enforcement is real and worth naming specifically when describing this space — but Kong
  and LiteLLM show it's not an gap *nobody* has closed.
- The **human-in-the-loop pending-approval queue** as a first-class middle state (not just
  allow/deny) is less commonly a headline feature in the gateway products surveyed — most treat
  approval workflows as an enterprise add-on rather than a core primitive.
- A **compact, readable reference implementation** you can point at to explain the whole pattern
  in one sitting is genuinely rarer than the pattern itself — most real implementations of this are
  buried inside platform code you can't read.

## Where the current implementation is thinner than the "converged" pattern

Being specific and self-critical, per the cited research:

- **Intersection vs. single-layer check.** OWASP's framing is effective permission = intersection
  of (user scope, agent scope, tool requirements) — three sets, not one. Worth explicitly checking
  whether the current scope-check logic actually intersects three distinct permission sets, or
  collapses to checking the agent's JWT scope against the tool's required scope with no separate
  accounting for the human user's own permission boundary.
- **Agent identity as a first-class principal.** The current model is "an Auth0 M2M client," which
  is a reasonable, standard way to give an agent its own credential — but the leading edge described
  in the research (Google's Agent Gateway with SPIFFE identity, Microsoft's Entra Agent ID) treats
  agent identity as a distinct principal *type* with its own lifecycle, not just another OAuth
  client. Worth understanding that distinction even if adopting it isn't warranted at this project's
  scale.
- **Ephemeral/JIT tokens.** OWASP's guidance leans toward just-in-time, short-lived tokens per task
  rather than long-lived agent credentials. Worth checking how long-lived the current agent tokens
  actually are in practice.
- **Transitive scope composition.** If Agent A can call Tool B, and Tool B can itself call Tool C,
  does scope enforcement hold transitively, or does it only check the first hop? The research flags
  this as generally understudied across the industry, not just here — genuinely worth a fresh look
  rather than assuming it's handled.

## Avenues worth pursuing next, roughly in priority order

1. **Map the current scope-check code path explicitly against OWASP's intersection principle** —
   this is the highest-leverage next step because it turns a vague "is this secure" question into a
   specific, falsifiable one: does the code actually compute an intersection of three sets, and if
   not, what's the concrete gap?
2. **Read Kong's MCP Tool ACL / OAuth2 scope-filtering docs in detail** as the closest real-world
   analog — not to copy it, but to have a precise, defensible answer to "how is this different from
   what Kong already ships" rather than a vague one.
3. **Trace how ephemeral the current agent tokens actually are**, and compare against the JIT-token
   pattern OWASP recommends.
4. **Revisit the audit trail's trace-ID correlation** against the emerging OpenTelemetry-based
   patterns referenced in the research — this is likely the area already closest to "industry
   consensus," worth confirming rather than assuming.
5. **Leave agent-identity-as-principal-type (SPIFFE / Entra Agent ID) as a watch item**, not a
   near-term build target — it's the bleeding edge, not yet the baseline, and adopting it before
   understanding whether it's actually needed at this scale would be solving a problem this project
   doesn't have yet.

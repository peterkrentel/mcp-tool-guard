# Research: Tool-Call Authorization in the Agentic Ecosystem

This folder is background research for reasoning about where `mcp-tool-guard` fits in the broader
agentic-AI security landscape. It is not project documentation (see `docs/` for that) — it's the
"step back and look at the whole map" material: what the industry actually does today, where the
gaps are, and where this project's specific approach is defensible vs. not.

## The problem, in one picture

Every agent loop (see any "agent loop" walkthrough: send messages with tools, execute the tool
Claude requests, feed the result back, repeat) has an **act** step — the moment a tool actually
gets invoked. The open question across the whole ecosystem is: *what enforces policy on that
step, and where does that enforcement actually live?*

The answer depends heavily on where the agent itself is running:

| Client type | Identity carried by the call | What (if anything) enforces policy today |
|---|---|---|
| Local/laptop MCP client (IDE, desktop app, personal script) | The human, ambiently — your OS session, your own CLI credentials | Nothing by default. "Authorized" just means "running as you." |
| Browser-based agent | A pre-signed or short-lived token baked into the client (nothing in a browser is secret) | Whatever server-side proxy sits in front of it — the client itself can only pre-check, never enforce |
| Enterprise backend agent | A scoped machine-to-machine token from an IdP (OAuth client credentials) | A gateway/proxy checking that token's scopes against policy before forwarding the call — this is `mcp-tool-guard`'s slot |
| Managed/hosted agent (provider-run sandbox) | Whatever credentials the sandbox is granted | The provider's control plane + whatever tools/MCP servers are actually wired in |

The industry-wide gap: the MCP protocol itself only standardizes **connection-level**
authentication (can this client talk to this server at all), not **per-tool, per-call**
authorization (can this specific caller invoke this specific tool, right now). That's left
entirely to whoever deploys MCP in practice — which is exactly the slot a gateway like
`mcp-tool-guard` occupies. See [`tool-authorization-landscape-2026.md`](tool-authorization-landscape-2026.md)
for the cited detail on that gap and how the market is (unevenly) filling it.

## What's in this folder

- **[`tool-authorization-landscape-2026.md`](tool-authorization-landscape-2026.md)** — cited
  research pass: what the MCP authorization spec actually covers, OWASP's Agentic AI / LLM Top 10
  framing of "excessive agency," what real AI-gateway products enforce vs. market, and what
  NIST/Auth0/Microsoft/Google's enterprise guidance converges on.
- **[`positioning.md`](positioning.md)** — analysis of where `mcp-tool-guard`'s specific approach
  is genuinely differentiated, where it overlaps with better-resourced competitors, and what to
  go deeper on next.

## How to use this

This is meant to be read, argued with, and revised — not treated as settled. Sources age fast in
this space (the MCP spec, OWASP's agentic framework, and every gateway vendor listed here are all
actively moving targets as of this writing). Treat every claim as "true as of the cited source,"
verify before relying on it for anything consequential, and update these files rather than letting
them go stale.

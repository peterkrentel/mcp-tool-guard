# Live MCPToolGuard Demo: GitHub `create_or_update_file`

This file was created by a real `create_or_update_file` tool call, routed through
the deployed guard proxy (`https://mcp-tool-guard-proxy.onrender.com/github/mcp`)
rather than a mock or simulated example.

## What happened

- **Client:** Claude Code, using the `ghprod` MCP server entry
  (`gateway`'s prod deployment on Render).
- **Auth:** a static pre-vended JWT (`MCP_PROD_STATIC_TOKEN`, see
  `scripts/claude-mcp-token-helper-prod-demo.sh`) sent as `Authorization: Bearer <token>`.
- **Enforcement point:** the guard proxy checked the token's scopes against
  `gateway/config.yaml` policy before forwarding the `create_or_update_file`
  call to GitHub's API.
- **Trace correlation:** the helper script attaches a fresh `X-Trace-Id`
  header (`cc-<uuid>`) per call, so this write's proxy/audit row can be
  looked up via `GET /audit` on the deployed proxy using that trace id.

## Why this matters

This is not a canned example — the commit that added this file is the
actual side effect of a real, guarded tool call. It demonstrates that a
write-scoped MCP tool call from an agent passes through MCPToolGuard's
enforcement layer end-to-end in the deployed (prod) environment, not just
in local dev.

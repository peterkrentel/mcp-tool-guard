# Claude Code demo — prod guard proxy (BL-037 follow-up)

**Navigation:** [Claude Code integration (local dev)](claude-code-integration.md) · [Track 2 GitHub proof](track2-github-proof.md) · [Guard proxy](guard-proxy.md) · [Architecture](ARCHITECTURE.md)

Where `claude-code-integration.md` documents Claude Code as an MCP client against the **local** dev proxy, this doc is the **prod** complement: driving the real, deployed Render guard proxy (`https://mcp-tool-guard-proxy.onrender.com`) from Claude Code, ending in a human-approved GitHub write. It also answers a question that comes up demoing this: *how does Claude actually call the MCP tool — is that a script, or a bunch of commands?*

## How Claude Code calls an MCP tool (mechanically)

It's neither a shell script nor a sequence of commands from the model's point of view — it's a **single MCP JSON-RPC request**:

1. The project's `~/.claude.json` registers an HTTP MCP server entry, e.g.:
   ```json
   "ghprod": {
     "type": "http",
     "url": "https://mcp-tool-guard-proxy.onrender.com/github/mcp",
     "headersHelper": "./scripts/claude-mcp-token-helper-prod-demo.sh"
   }
   ```
2. On connect, Claude Code's harness (not the model) runs `headersHelper` **once**, as a subprocess, and reads whatever JSON header map it prints on stdout. `scripts/claude-mcp-token-helper-prod-demo.sh` sources a static pre-vended token (`MCP_PROD_STATIC_TOKEN`) and prints `{"Authorization": "Bearer <jwt>", "X-Trace-Id": "cc-<uuid>", "X-Wait-For-Approval": "true"}`. This is a workaround for BL-048 — `/agents.html`'s "Create agent" flow never surfaces a `clientSecret`, so there's no way to mint fresh tokens on demand for a prod demo the way the local `claude-mcp-token-helper.sh` does; a static token has no refresh and is only good until its own `exp` claim.
3. When the model decides to call a tool (e.g. `create_or_update_file`), the harness sends one `tools/call` JSON-RPC POST to that URL with those headers attached, and the tool's arguments (`owner`, `repo`, `path`, `content`, `message`, `branch`, ...) as the JSON-RPC params — no intermediate script executes per call.
4. The model sees exactly one response back: the eventual result, whatever it took to produce it server-side (allow, deny, or — as below — a scope-deny held for human approval and resolved before responding).

Everything described past this point happens **inside that single held-open HTTP request**, server-side.

## What we ran

From this repo, on `main`, using the `ghprod` server:

```
mcp__ghprod__get_file_contents(owner=peterkrentel, repo=mcp-tool-guard, path=demo-guard.md, ref=refs/heads/main)
mcp__ghprod__create_or_update_file(owner=peterkrentel, repo=mcp-tool-guard, path=demo-guard.md, branch=main, ...)
```

The agent behind `ghprod`'s static token has **`repo:read` only** — no `repo:write`. Both calls shared one session-level trace id, `cc-d9367453-5eed-4042-acad-1fce3f4649a5`.

### Observed sequence (Claude Code ops view + Grafana, `cc-d9367453...`)

| Time (UTC) | Source | Decision | Tool | Detail |
|---|---|---|---|---|
| 15:05:20.875 | proxy | allow | `get_file_contents` | `required=repo:read`, token has it |
| 15:05:22.161 | mcp | allow | `get_file_contents` | forwarded to GitHub, 1284ms |
| 15:05:40.278 | proxy | **deny** | `create_or_update_file` | `required=repo:write`, `reason=Missing required scope 'repo:write'` |
| 15:05:40.691 | proxy | pending | `create_or_update_file` | `reason=Awaiting approval (pr_a66dd6929d8c)` |
| 15:05:48.950 | proxy | allow | `create_or_update_file` | `reason=Pending request approved (pr_a66dd6929d8c)` |
| 15:05:49.130 | proxy | allow | `create_or_update_file` | `reason=Pending request approved (pr_a66dd6929d8c)` |
| 15:05:50.877 | mcp | allow | `create_or_update_file` | forwarded to GitHub, 1994ms — real commit created |

The deny and pending rows appear back-to-back because the scope check (`checkScope` in `gateway/guard.ts`) logs the `deny` unconditionally, and — because the approval queue is enabled and the request opted into `X-Wait-For-Approval: true` — `proxy-routes-mcp.ts` immediately follows it with a `pending` row instead of returning the deny to the caller. The two adjacent `allow` rows come from two independent logging points (the `/pending/:id/approve` action itself, and the long-poll handler noticing the resolved state) rather than the client retrying anything.

### The approval gate, live

Between `pending` (15:05:40) and the first `allow` (15:05:48) — about 8 seconds — an operator (signed in with Auth0 `gateway:admin`) had the **Claude Code ops view** (`ui/claude-ops.html`, filtered to client type "Claude Code") open and clicked **Approve** on the pending `create_or_update_file` card (`pr_a66dd6929d8c`, `server: github`, `needs: repo:write`, `agent has: repo:read`).

## Full request lifecycle (code references)

1. **Scope check, first audit line** — `handleMcpRoute` (`gateway/proxy-routes-mcp.ts`) calls `guard.authorize()` → `checkScope()` (`gateway/guard.ts`). Missing scope logs `decision: "deny"` immediately, before any approval logic runs.
2. **Pending creation** — `createPendingRequest()` (`gateway/pending-store.ts`) mints a `pr_<12 hex>` id and logs `decision: "pending"`.
3. **Long-poll hold** — because the request carried `X-Wait-For-Approval: true`, the same HTTP connection is held open server-side by `waitForPendingResolution()` (`gateway/pending-store.ts`), which re-checks the pending record every 750ms until approved/denied or `pendingLongPollMaxMs()` (default 120s, `gateway/env.ts`) elapses. Claude Code's tool call is simply waiting on one open connection this whole time — no client-side polling or replay (this is the BL-045 fix; see `docs/claude-code-integration.md` for what it looked like *before* this existed, when an approved write was silently lost).
4. **Human approval** — `POST /pending/:id/approve` (`gateway/proxy-routes-pending.ts`), triggered by the Approve button in `ui/claude-ops.html`, resolves the pending record and logs its own `allow`.
5. **Forward and final result** — once resolved, the original held request forwards to the real GitHub MCP upstream and logs the `source: "mcp"` `allow` — this is the response Claude Code's `tools/call` finally receives.

## Result

Real commit [`6f48fd6`](https://github.com/peterkrentel/mcp-tool-guard/commit/6f48fd6590f3dc46c7085ae9ed4d35f274b66a0a) adding `demo-guard.md` to `main`. Note: this landed directly on `main` because `create_or_update_file` writes straight to whatever `branch` is passed — it doesn't go through local git, so the repo's usual "always a feature branch" workflow rule has to be applied explicitly by naming a non-`main` branch in the call, not by whatever the local git checkout happens to be on. This run intentionally targeted `main` as a one-off; treat that as the exception, not the pattern, for future demos.

## Observability

Same three-layer audit model as the rest of the project (see `ARCHITECTURE.md`): the client pre-check layer doesn't apply here (Claude Code has no `ToolGuard` pre-check of its own), so only proxy and mcp rows exist, both queryable via `GET /audit` on the deployed proxy and visualized in the [Claude Code client Grafana dashboard](../dashboards/grafana/mcp-tool-guard-claude-code-client.dashboard.json) and the [Claude Code ops view](https://mcp-tool-guard-ui.vercel.app/claude-ops.html), both filterable on the `cc-` trace id prefix.

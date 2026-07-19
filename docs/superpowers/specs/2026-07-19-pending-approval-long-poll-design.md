# BL-045 design: pending-approval long-poll for MCP-native clients

## Status

Design decision only — no code changes in this doc.

## Problem statement

The BL-037 smoke test (Claude Code as an MCP client against `gateway/proxy-server.ts` + `gateway/proxy-routes-mcp.ts`, `github` upstream, `repo:read`-only agent) confirmed that the existing approval-queue UX is broken for any MCP client that isn't this project's own browser SDK:

1. A write call needing approval gets `sendJsonRpcPending` (`gateway/http-helpers.ts`): HTTP 202, `{"result":{"status":"pending","pending_id":"pr_...","pending_poll_token":"pt_..."}}`.
2. Claude Code's MCP client has no concept of "pending" as a JSON-RPC result shape — it's a non-standard extension the browser SDK invented for itself. Claude Code just idles on the still-open logical exchange until its own client-side idle timeout (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, default ~300s) fires: *"sent no response or progress for Ns; aborting."* Confirmed twice in the smoke test, identical behavior both times.
3. A human approves via `POST /pending/:id/approve` (`gateway/proxy-routes-pending.ts`), minting a single-use `approval_token` (`at_...`) bound to `(server_id, tool)` — not to the specific argument values (`gateway/pending-store.ts` `generateApprovalToken`).
4. Only `ui/src/gateway-agent.ts` (`retryApprovedTool`) knows how to close this loop: it keeps the original tool name + args in JS memory, polls `GET /pending/:id`, and re-issues the original `tools/call` with `X-Approval-Token` once approved.
5. Claude Code has no equivalent of step 4. `gateway/pending-store.ts`'s `PendingRequest` type is metadata-only (`id`, `trace_id`, `session_id`, `server_id`, `tool`, `required_scope`, `token_scopes`, `agent_id`, `requested_at`, `status`, `resolved_at`, `resolved_by`) — the original JSON-RPC body/arguments are never persisted anywhere. If the calling client doesn't independently remember its own args and manually replay them (as was done by hand during the smoke test via a reconstructed `node fetch` call, which did succeed and produced a real GitHub commit), an approved-but-never-forwarded write is silently and permanently lost. There is no audit trail entry for "approved but nobody ever came back to redeem it" beyond the one `Pending request approved (pr_...)` log line.

This is a client-compatibility gap, not a security bug — the proxy's scope enforcement and single-use-token semantics are working exactly as designed. The gap is: **for any client that can't run custom retry logic, an approved write goes nowhere.**

## Options considered

### Option A — proxy holds the request open (long-poll) until approved

Instead of answering immediately with 202, `handleMcpRoute` (`gateway/proxy-routes-mcp.ts`) would, at the exact point it currently calls `createPendingRequest` + `sendJsonRpcPending`, *not* respond yet. The original `body`/`forwardHeaders` are already sitting in local variables in that function — no new storage is needed. Instead it would poll its own `pending-store.ts` (`getPendingRequest`) at a short interval (e.g. every 500ms–1s) until the record resolves to `approved`, `denied`, or a max-wait elapses, then either:
- **approved**: call `forwardMcpPost` directly with the already-in-memory original `body`/headers on the *same* held connection — no `X-Approval-Token` round trip needed for this path, since the args never left process memory. (The token still gets minted by `POST /pending/:id/approve` as a side effect for any other observer that wants to redeem it out-of-band — harmless, it just expires unused after its 1hr TTL if nothing else calls `validateApprovalToken`.)
- **denied/expired**: return a real JSON-RPC error on the held connection.

**Opt-in, not a global behavior change.** BL-037's own mechanism already gives us the right lever: `scripts/claude-mcp-token-helper.sh` (the `headersHelper`) injects a static header map at connect time (`Authorization`, `X-Trace-Id`). We'd add one more static header, e.g. `X-Wait-For-Approval: true`, so Claude Code's connections ask for hold-and-forward while the browser GUI's `ui/src/gateway-agent.ts` — which never sends that header — keeps getting today's immediate 202 unchanged. Both models coexist behind one conditional in `handleMcpRoute`; nothing about the existing pending-queue GUI workflow (`GET /pending`, approve/deny buttons, `retryApprovedTool`) needs to change, since a long-poll connection is just another passive observer of the same `PendingRequest` record — resolving it is already idempotent-guarded in `pending-store.ts`.

**How long to hold, and what bounds it:**
- Client-side ceiling: Claude Code's own idle timeout (default ~300s, operator-configurable via `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` per the `.mcp.json` entry). Any proxy-side max-wait must stay comfortably under whatever the operator configured there, or the client aborts first and the proxy's eventual "approved" answer arrives at a closed socket.
- Server-side ceiling: Node's own HTTP server default timeouts (`gateway/proxy-server.ts`) need to be checked explicitly against the pinned Node version rather than assumed, before relying on multi-minute holds.
- Infra ceiling (biggest unknown): the proxy is deployed on Render (`docs/render-deploy.md`), whose edge/reverse-proxy may impose its own idle/read timeout that isn't clearly documented — a value that works against `localhost:8787` in dev could get silently killed by Render's front door in prod. Must be measured empirically before picking a production default.
- Recommendation: make the cap an explicit env var (`MCP_PENDING_LONGPOLL_MAX_MS`, conservative default, well under the client default) rather than hardcoding a number now, and document that operators raising `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` and `MCP_PENDING_LONGPOLL_MAX_MS` together is an expected operational step, not a bug.

**Restart-in-flight loss:** if the proxy process restarts while a request is held open, that connection drops regardless of whether `pending-store.ts` is in-memory or KV-backed — a new process picking up the `PendingRequest` from KV doesn't help a client now looking at a broken socket. This is a real but bounded regression versus today's 202 model (which lets a client re-poll after a restart because it kept `pending_id`) — an accepted tradeoff worth stating explicitly, not glossed over. A standard MCP client retrying its whole `tools/call` after a dropped connection is reasonable behavior regardless.

**Resource/DoS concern:** each held connection is a cheap socket plus a polling interval; this is a human-approval-gated path by construction, not a hot path, and existing rate limiting in `gateway/proxy-server.ts` already bounds how many long-polls a single client can open. No new mitigation required for a first version.

**Named but out of scope for Phase 1:** Claude Code's own timeout message implies its idle timer resets on MCP `notifications/progress` messages, not just a final response. A future iteration could have the proxy emit periodic progress notifications on the held (SSE-mode) connection while waiting, making the effective wait bounded mainly by our own sanity cap rather than racing the client's fixed idle timeout. Real de-risking option, real added transport complexity — ships in Phase 2, not this ticket.

### Option B — Claude-Code-specific client-side wrapper

A small persistent local process (e.g. Node on `localhost:8788`) that `.mcp.json`'s `url` points at instead of the guard proxy directly, proxying through to `localhost:8787`. It would intercept `tools/call`, remember args in its own memory, detect the 202/pending shape, poll `/pending/:id` itself, and replay with the approval token once approved — `ui/src/gateway-agent.ts`'s `retryApprovedTool` reimplemented as a standalone process.

This does not actually solve the problem, it relocates it: Claude Code is still holding one HTTP connection open (to the wrapper instead of the guard proxy) and is still subject to the same idle-timeout logic while the wrapper polls in the background. It also needs its own persistence to survive restarts mid-poll, duplicating state that already lives server-side in `gateway/pending-store.ts`. Net new code and operational surface (a new process to install, run, keep alive, and document per-user) for no capability Option A doesn't already provide once the proxy itself holds the connection.

### Option C (named, not designed further) — change queue semantics instead of holding

- **Webhook/push instead of poll**: doesn't fit — the "caller" is Claude Code's MCP client, which has no listening endpoint of its own to push a callback to.
- **Push "pending" to the model as a normal tool result, let a human re-invoke later**: rejected — still loses the original args (same root cause as today) and pushes retry burden onto a human re-typing a request, strictly worse than A or B.

Neither changes the recommendation below.

## Recommendation

**Option A: proxy holds the request open (long-poll), gated behind a `headersHelper`-injected opt-in header, reusing the existing BL-037 mechanism rather than introducing a new client-side process.**

## Rationale

- **Zero client-side changes** — BL-037's whole point was proving the guard proxy is harness-agnostic. Option B reintroduces a harness-specific dependency (a wrapper process the user must install and keep running); Option A works for Claude Code, curl, or any other simple MCP-over-HTTP client without asking any of them to understand a non-standard `pending` shape.
- **No new persistence** — the original request body/args are already in memory in `handleMcpRoute` at the exact moment the code currently gives up and returns 202. Option A spends that memory instead of discarding it; Option B would have to reconstruct equivalent state in a second process for no benefit.
- **Strictly less code and operational surface** — Option A is a conditional inside an existing function plus one new header in an existing helper script; Option B is a whole new always-running process with its own lifecycle, config, and failure modes to support.
- **Coexists cleanly with what already works** — the browser GUI's polling model, the approval-queue admin UI, and the approval-token mint/burn semantics are untouched.
- **The honest cost, stated plainly**: it trades an infra-timeout risk (does the held connection survive the wait) for a client-compatibility problem (does the client understand a custom result shape) — the infra risk is one we control and can tune; the client-compatibility problem is not ours to fix inside a third-party MCP client.

## Explicitly out of scope

- Emitting MCP `notifications/progress` over a held SSE-mode response — legitimate Phase 2 refinement, not attempted here.
- Any redesign of `pending-store.ts`'s data model, TTL/pruning behavior (tracked separately as BL-044), or approval-token mint/burn mechanics.
- Building or documenting Option B's wrapper process — rejected above, not partially implemented as a fallback.
- Verifying/tuning exact values for `MCP_PENDING_LONGPOLL_MAX_MS`, Node server timeouts, or Render's real edge timeout — requires empirical measurement during implementation, not guessed at here.
- Webhook/push-based approval delivery (Option C) — named only.
- Any change to the browser GUI's (`ui/src/gateway-agent.ts`) existing immediate-202-then-poll behavior.

## Self-review notes

- The biggest unverified assumption is Render's real edge/proxy timeout behavior for long-held connections (`docs/render-deploy.md` only documents the ~15-minute idle *spin-down*, a different mechanism from a per-request hold timeout) — implementation must measure this before picking `MCP_PENDING_LONGPOLL_MAX_MS`'s default.
- The recommendation leans on `headersHelper` being able to inject a static per-connection header — consistent with BL-037's documented mechanism (`Authorization`, `X-Trace-Id` today); the connect/reconnect-only re-invocation semantics mean the opt-in is session-scoped, matching Claude Code's actual behavior.
- Considered and rejected a per-server `config.yaml` flag instead of a header: a header keeps the choice with the calling client, the right owner of "can I tolerate a held connection" — a per-server flag would force one behavior on every client hitting that server, worse for the browser GUI, which shares the `github` server config with Claude Code in the smoke-tested setup.

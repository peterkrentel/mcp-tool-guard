# Claude Code ops view — design spec

## Status

Design decision only — no code changes in this doc.

## Problem statement

Today, seeing whether a Claude-Code-originated (or any other client's) MCP tool call needs approval requires already knowing to open `/agents.html` and manually inspecting each pending item's metadata — nothing distinguishes which client originated a given request. This was surfaced live during BL-045's smoke test: a Claude Code write call went to `pending`, and the only way to know it needed action was to already be looking at the approval queue panel, with no visual indication it came from Claude Code specifically versus the browser's own agent.

`/agents.html` already has both an "Approval queue" panel and a "Three-layer audit" panel — the gap isn't missing UI, it's the lack of (a) a per-client-type view and (b) a page you'd naturally have open for exactly this purpose, separate from the multi-purpose agent-provisioning page.

## Goal

An admin/security-role ops view — not a personal local-only tool — for watching and approving MCP tool-call activity filtered by originating client type, reusing this project's existing admin auth model exactly as-is.

## Client-type classification

Three client types are already distinguishable via existing, unrelated trace-id conventions already in the codebase — no new tagging convention is introduced by this feature:

- **`claude-code`** — `trace_id` starts with `cc-` (BL-037's `scripts/claude-mcp-token-helper.sh` convention).
- **`browser-gui`** — `trace_id` starts with `tr_` (existing `ui/src/trace.ts` `newTraceId()` convention, used by `ui/src/gateway-agent.ts`).
- **`unattributed`** — no `trace_id`, or a `trace_id` matching neither prefix (e.g. raw curl/API calls).

This becomes a single pure function, `classifyClientType(traceId?: string)`, reused everywhere origin needs to be determined. When BL-046 ships a formal `X-Client-Type` header, this function's *implementation* changes to read that header/field instead of pattern-matching `trace_id` — the rest of this feature (the page, the dropdown, the filtering) is unaffected, since it only depends on the function's return value, not how it derives it.

## Architecture

A new static page, `ui/claude-ops.html`, with its own controller module `ui/src/claude-ops-main.ts` — structurally a sibling to the existing `ui/agents.html` / `ui/src/agents-main.ts` pair, not a replacement for either. Reuses the existing admin Auth0 sign-in gate (`ui/src/auth.ts`) exactly as `/agents.html` does today — same `gateway:admin` requirement when `control_plane_auth` is enabled, open locally otherwise. A nav link is added to `site-nav` on all three pages (`index.html`, `agents.html`, `claude-ops.html`) pointing at the new page.

Two panels on the page: a filtered pending-approval list (with Approve/Deny buttons) and a filtered audit feed, both driven by a client-type `<select>` dropdown defaulting to `claude-code`. Both panels poll their existing endpoints (`GET /pending`, `GET /audit`) every 2 seconds, matching `/agents.html`'s existing audit-poll cadence — no new push/websocket transport.

## Components

- **`ui/src/client-type.ts` (new)** — exports `classifyClientType(traceId?: string): "claude-code" | "browser-gui" | "unattributed"`. Pure function, single source of truth, no dependencies beyond a string check.
- **`ui/src/pending-view.ts` (new)** — exports `renderPendingList(container: HTMLElement, items: PendingRequest[], handlers: { onApprove(id: string): void; onDeny(id: string): void }): void`. Extracted from `ui/src/agents-main.ts`'s current inline `refreshPending()` card-building logic (lines ~374-396) — same HTML/CSS output, just relocated into its own module so it has one home instead of being duplicated. `ui/src/agents-main.ts` is refactored to call this shared function instead of its inline template (behavior-preserving; the existing `/agents.html` panel's appearance and behavior do not change).
- **`ui/src/agents-audit-view.ts`'s existing `renderThreeLayerAudit()`** — reused unmodified, called with a pre-filtered `entries` array.
- **`ui/src/proxy-api.ts`'s existing `PendingRequest` interface** — needs `trace_id?: string` and `wait_for_approval?: boolean` added (currently missing both, out of sync with the gateway's actual type after BL-045). Required for this feature to filter/display correctly; a small, targeted fix alongside this work.
- **`ui/claude-ops.html` + `ui/src/claude-ops-main.ts` (new)** — the page itself: admin sign-in check (reusing `auth.ts`), a client-type `<select>` (`claude-code` / `browser-gui` / `unattributed` / `all`), fetches via `proxy-api.ts`'s existing `listPendingRequests()` / `fetchAuditEntries()` (or equivalent existing function — confirm exact name during planning), filters both arrays client-side via `classifyClientType`, renders via the two shared functions above, wires Approve/Deny to the existing `approvePendingRequest`/`denyPendingRequest` calls.

## Data flow

Page loads → admin auth check (redirect to sign-in if unauthenticated and `control_plane_auth` is on, same as `/agents.html`) → poll `GET /pending` and `GET /audit` every 2s → filter both result arrays by `classifyClientType(item.trace_id) === selectedType` (or no filter when `all` is selected) → render via `renderPendingList()` / `renderThreeLayerAudit()` → Approve/Deny clicks call the existing pending-resolution endpoints → next poll tick reflects the change. No optimistic UI — 2s latency is acceptable for a human-approval workflow.

## Error handling

Reuses the existing pattern already on `/agents.html`: a fetch failure renders an inline `.log-error`-classed message in the affected panel; polling continues on the next tick rather than stopping entirely. No new error-handling design — this is an existing, working convention being reused as-is.

## Testing

This repo has no UI test suite today (`CLAUDE.md`: "there is no UI or Python test suite currently"). Consistent with that existing convention, verification for this feature is manual: `npm run build -w @mcp-tool-guard/ui` for a clean build, then a real browser walkthrough (sign in, confirm pending/audit entries filter correctly by client type using real `cc-`/`tr_`-prefixed traffic, confirm Approve/Deny still works) via the `run` skill's pattern — not a new automated test framework introduced for one page.

## Explicitly out of scope

- Server-side filtering (`GET /pending?client_type=...`) — deferred; client-side filtering on already-small demo-scale data is sufficient today. Revisit only if data volume ever grows enough to matter.
- Summary/counter tiles (e.g. "2 pending, 14 allowed") — decided against for v1; kept to the two panels already proven useful on `/agents.html`.
- Push-based real-time updates (SSE/WebSocket) — 2s polling matches existing project convention and is fast enough for a human-approval workflow.
- Building BL-046's formal `X-Client-Type` header — this feature works today against the existing `cc-`/`tr_` trace-id prefix conventions; BL-046 remains its own separate backlog item, and this page's `classifyClientType()` function is the single point that will need updating once BL-046 ships.
- Any change to `/agents.html`'s own approval queue / audit panels beyond the `renderPendingList()` extraction needed to avoid duplicating template code — no filter dropdown is being added there.

## Self-review notes

- Confirmed via direct code read that `ui/src/agents-audit-view.ts` already exports a reusable `renderThreeLayerAudit()`, and that the browser's own trace-id convention (`tr_` prefix, `ui/src/trace.ts`) is distinct from Claude Code's (`cc-` prefix, `scripts/claude-mcp-token-helper.sh`) — the three-way client-type classification is grounded in code that already exists, not invented for this design.
- `ui/src/proxy-api.ts`'s `PendingRequest` interface is missing `trace_id` and `wait_for_approval` (both exist server-side after BL-045) — flagged explicitly as an in-scope fix above, not a silent gap.
- The exact existing function name for fetching audit entries in `proxy-api.ts` should be confirmed against the real file during implementation planning rather than assumed here.

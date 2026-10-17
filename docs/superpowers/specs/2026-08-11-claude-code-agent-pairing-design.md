# Claude Code agent pairing — no-copy-paste credential handoff design

## Status

Design decision only — no code changes in this doc. Implementation deliberately deferred until `feature/entra-idp-adapter` merges, to avoid cutting a second long-lived branch that touches `backlog.md`/`CHANGELOG.md` before the first one lands.

## Problem statement

`docs/claude-code-integration.md` and `docs/claude-code-demo.md` already solve "never copy a JWT" — `scripts/claude-mcp-token-helper.sh`, a Claude Code `headersHelper`, mints a fresh short-lived JWT on every connection from an M2M `clientId`/`clientSecret`. But that mechanism still requires one manual, one-time step: creating the agent (via `agents.html` or curl) and hand-pasting its `clientId`/`clientSecret` into `scripts/dev.env`. That is the last remaining manual credential-copy step in the project, and it's what this design removes.

A second, related gap: nothing today lets a human look at `claude-ops.html` and see *which agent* a given Claude Code MCP-server registration is actually using. That binding only exists implicitly — by virtue of whichever `clientId`/`clientSecret` happened to get pasted into `dev.env`. There's no record of it, and no way to revoke just that binding without deleting the whole agent.

## Goal

Let a human approve, once, which existing agent a specific Claude Code MCP-server registration (`ghprod`, or whatever it's named) is allowed to act as — with no credential ever manually typed or pasted, anywhere — and give `claude-ops.html` a persistent, revocable record of every such binding.

## Architecture

A new concept, **pairing**, binds one local Claude Code MCP-server registration to one existing agent, established through a single human approval on `claude-ops.html`, reused indefinitely until revoked.

```
First connection for a given server registration (no local credential yet):
  headersHelper --POST /pair {serverName, serverUrl}--> proxy
  proxy: creates a pending PairingRecord, returns {pairingId}
  headersHelper: prints "approve pairing <id> for '<serverName>' on claude-ops.html", polls GET /pair/:id
  claude-ops.html: "Pairing requests" panel shows it -> admin picks an agent -> Approve
  proxy: POST /pair/:id/approve {clientId} -> generates opaque pairing token, stores its hash, marks approved
  headersHelper: next poll gets {status: approved, clientId, pairingToken} (delivered exactly once)
                 -> writes ~/.mcp-tool-guard/pairings/<serverName>.json (0600) -- never typed by a human
                 -> immediately mints and returns the JWT for this connection

Every connection after that:
  headersHelper: reads the local pairing file, presents the pairing token to
                 POST /agents/:clientId/token -> fresh short-lived JWT, same shape as today
```

## Components

- **`gateway/pairing-store.ts`** (new) — same `kv.ts`-backed pattern as `gateway/pending-store.ts` (KV when configured, in-memory `Map` fallback otherwise): `PairingRecord { id, serverName, serverUrl, status: "pending" | "approved" | "denied" | "revoked", clientId?, pairingTokenHash?, pairingTokenPlaintext? (transient, cleared after first delivery), createdAt, approvedAt?, lastUsedAt? }`. Pending records get a short TTL (5 min) if never approved, mirroring the existing `pt_` poll-token TTL convention already in `pending-store.ts`.
- **`gateway/proxy-routes-pairing.ts`** (new):
  - `POST /pair` — unauthenticated (a device-code-style request), `{serverName, serverUrl}` → `{pairingId}`.
  - `GET /pair/:id` — unauthenticated (the id itself is the nonce). Returns `{status}`; the *first* poll observing `status: "approved"` also includes `{clientId, pairingToken}` — after that one delivery, the plaintext token is cleared from the record and never included again, mirroring the burn-on-use semantics `pending-store.ts` already uses for `at_` approval tokens.
  - `POST /pair/:id/approve` (`gateway:admin`) — `{clientId}`, the admin's agent choice. Validates the agent exists (`agent-store.getAgent`), generates the opaque pairing token, stores only its SHA-256 hash long-term (one-way — verification never needs the plaintext back, unlike `agent-secrets.ts`'s reversible AES-GCM client-secret encryption, so `node:crypto`'s `createHash` is used directly here instead of reusing that module).
  - `POST /pair/:id/deny` (`gateway:admin`).
  - `GET /pairings` (`gateway:admin`) — list, for the UI panel (no token/hash in the response).
  - `DELETE /pairings/:id` (`gateway:admin`) — marks `revoked`; its hash no longer validates.
- **`gateway/proxy-routes-agents-token.ts`** (modified) — `POST /agents/:clientId/token` accepts a second auth path alongside the existing `gateway:admin` bearer: a pairing token (e.g. `X-Pairing-Token` header). On presence, look up the pairing record by hash-of-presented-token, require `status === "approved"` and `record.clientId` matching the URL's `:clientId`, update `lastUsedAt`, then proceed exactly as today — delegates to the same `idpAdapter.vendToken()`, no IdP-specific branching added.
- **`ui/claude-ops.html` + `ui/src/claude-ops-main.ts`** (extended) — two new panels alongside the existing pending-approval and audit panels, same 2-second polling convention already established there:
  - **Pairing requests** — pending `PairingRecord`s, an agent `<select>` (from the existing `GET /agents`), Approve/Deny buttons.
  - **Active pairings** — approved records: server name, bound agent, created/last-used timestamps, a Revoke button.
- **`scripts/claude-mcp-token-helper.sh`** (extended) — reads `CLAUDE_CODE_MCP_SERVER_NAME`/`CLAUDE_CODE_MCP_SERVER_URL` (confirmed real, added in Claude Code v2.1.85, passed to every `headersHelper` invocation) to know which local pairing file to use. Fast path: read the file, mint via the pairing-token auth path. First-run (or file missing/rejected) path: run the `POST /pair` → poll `GET /pair/:id` loop described above, write the file on approval, then mint.

## Data flow

1. **First connection**: no local pairing file → helper requests a pairing → prints instructions → polls → admin approves on `claude-ops.html`, picking the agent → helper receives `{clientId, pairingToken}` once, persists it locally, mints the first JWT.
2. **Steady state**: helper reads the local file every connection, presents the pairing token to `/agents/:clientId/token`, gets a fresh JWT — same latency/shape as today's `clientId`/`clientSecret` path.
3. **Everything downstream of "Claude Code has a JWT"** — the actual `tools/call` flow, scope checks, deny/pending/approve, audit trail — is entirely unchanged; this design only replaces how the JWT-minting credential reaches the local machine.

## Error handling

- **Nobody approves in time** — the pairing *request* (not the eventual credential) expires after its short TTL; the helper exits with a clear stderr message, Claude Code surfaces a normal connection failure, and reconnecting starts a fresh pairing request.
- **Denied** — the next poll returns `denied` immediately; no need to wait out the full timeout.
- **Revoked after the fact** — the next mint attempt gets a 401 from `/agents/:clientId/token`; the helper deletes its now-invalid local file on that specific failure, so the *next* connection attempt automatically re-triggers pairing instead of failing forever silently.
- **Agent created under a different active IdP provider** — inherits today's existing failure mode in `idpAdapter.vendToken()` unchanged (a pre-existing, separately-tracked gap — see Explicitly out of scope).

## Testing

- Unit tests: `gateway/tests/pairing-store.test.mjs`, same style as the existing `pending-store` tests — create/approve/deny/revoke, one-time plaintext delivery, hash verification.
- Route tests: the new `/pair*`/`/pairings*` endpoints, and the extended dual-auth path on `POST /agents/:clientId/token`.
- One real live run through Claude Code end-to-end — mirroring the verification bar already used for BL-037/BL-045 and the live Entra test (unit tests alone don't prove the real `headersHelper`/`CLAUDE_CODE_MCP_SERVER_NAME` behavior against the actual Claude Code binary).

## Explicitly out of scope

- The pre-existing Auth0/Entra provider-routing gap (`MCP_IDP_PROVIDER` is one global setting; agents created under a previously-active provider get orphaned if it's flipped) — real, already acknowledged in `CHANGELOG.md`, unrelated to this feature.
- A product-grade UI redesign of `agents.html`/`claude-ops.html` — a separate, later initiative; this design only adds two panels to the existing `claude-ops.html` page.
- Expiry/rotation of the pairing credential itself once approved — kept simple: revoke-only, no auto-expiry, matching this project's current stage.
- Any "create agent" / "register MCP server" UI on `claude-ops.html` — stays exclusively on `agents.html`, unchanged; pairing only ever selects among agents that already exist.
- Generalizing to other MCP harnesses (OpenCode, VS Code's native MCP support, etc.) — the backend (`/pair`, `/agents/:clientId/token`, the guard's scope check) is plain HTTP and harness-agnostic by construction, but building or documenting a second harness's local helper script is future work, contingent on that harness having its own `headersHelper`-equivalent.

## Self-review notes

- Grounded in direct reads of `gateway/pending-store.ts` (KV-backed store pattern, `at_`/`pt_` token TTL and burn-on-use conventions) and `gateway/agent-store.ts` (per-agent encrypted-secret storage) — this design reuses those existing conventions rather than inventing new ones.
- Confirmed `CLAUDE_CODE_MCP_SERVER_NAME`/`CLAUDE_CODE_MCP_SERVER_URL` are real, working `headersHelper` environment variables (Claude Code changelog v2.1.85) via direct lookup, not assumed from the email that originally prompted this design.
- The pairing token's hash uses `node:crypto`'s one-way `createHash`, deliberately not `gateway/agent-secrets.ts`'s reversible AES-GCM helper — noted explicitly so a future reader doesn't assume all stored secrets in this codebase must be reversible.
- Left undecided, as a genuinely small implementation choice: the exact header name for presenting a pairing token (`X-Pairing-Token` vs. an `Authorization: Bearer pc_...` prefix convention) — not resolved here to avoid pretending more certainty than exists.

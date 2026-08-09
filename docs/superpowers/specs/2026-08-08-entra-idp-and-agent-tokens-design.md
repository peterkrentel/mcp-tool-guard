# BL-021: Entra IdP Adapter + Agent Token Self-Refresh (BL-048 completion)

## Status

Design only — no code changes in this doc. Implements BL-021 (Entra JWT validation + adapter), completes BL-048 (surface `client_secret` from `/agents.html`), folds in BL-029 (Entra role-to-scope mapping), and adds a config-driven login button for the browser harness. Keycloak (BL-041) is deliberately skipped — its purpose was de-risking the `JwtValidator`/`IdpAdapter` abstraction before Entra, and that abstraction is already interface-complete and Auth0-proven (BL-019/BL-020 shipped), so building Keycloak first would be process for its own sake here.

## Context

Two separate things currently only work via Auth0, and both need an Entra equivalent:

1. **Human admin login (browser harness)** — a person logs into the browser UI (Auth0 SPA login today) to get the `gateway:admin` role, which lets them use `/agents.html` to create/delete M2M agents and register MCP servers (`/servers`). This stays a human, interactive, session-based login — Entra just becomes a second option for *which* IdP that login goes through.
2. **Agent token (M2M)** — a non-human identity (e.g. Claude Code, or the GitHub/Slack vendor agents) with its own `client_id`/`client_secret`, minted via `/agents.html` (calling the IdP's Management/Graph API), that self-mints short-lived JWTs via `client_credentials` against `/token`. This is a completely separate identity from whoever created it — the agent has its own token, never a delegated/human-derived one.

**The actual pain point today**: (2) is not self-service end-to-end. `/agents.html` creates the M2M client server-side but doesn't reliably surface the resulting `client_secret` back to the operator (BL-048). So instead of configuring `client_id`+`client_secret` once and letting Claude Code's `headersHelper` script self-refresh forever, the operator has had to go back into the browser repeatedly, mint an already-vended JWT, and paste that static token into Claude Code's config — which goes stale with no refresh path. This is the "copying a token" problem being solved — not a missing OAuth-for-humans flow on Claude Code's side (confirmed via research: Claude Code does have native OAuth/PKCE support for MCP servers, but that flow is for human-delegated login, which is explicitly not what's wanted here — agents keep their own M2M identity).

Both BL-021 (Entra) and BL-048 (client_secret surfacing) are prerequisites for the same end goal — Entra becoming a fully-supported second IdP for both halves above — so they're specified together.

## Decision

Build the Entra `JwtValidator`/`IdpAdapter` pair per the existing BL-034 single-active-IdP model (`MCP_IDP_PROVIDER=entra`, no concurrent trust), complete the client_secret-surfacing gap generically (works for either IdP), and add a config-driven login button. No new architecture beyond what BL-019/BL-020 already defined — this is implementing against already-decided interfaces, not designing new ones.

## Architecture

```
                    Browser harness (human, interactive)
                              |
                    Sign in with Microsoft / Auth0
                    (whichever MCP_IDP_PROVIDER is set)
                              |
                    gateway:admin session
                              |
                    /agents.html: create agent -----> Graph API / Auth0 Mgmt API
                              |                        (EntraIdpAdapter.createAgent /
                              |                         Auth0IdpAdapter.createAgent)
                              v
                    client_id + client_secret
                    shown ONCE to operator
                              |
              (one-time manual step: operator drops these into the
               EXISTING headersHelper script's env/credential store —
               scripts/claude-mcp-token-helper.sh, already registered
               in Claude Code's .mcp.json today. Claude Code's own
               config/settings are never touched.)
                              |
                              v
                    Claude Code (agent, non-human)
                              |
                    headersHelper: POST /token (client_credentials)
                    every connect/reconnect, self-refreshing forever
                              |
                              v
                    guard proxy: EntraJwtValidator / Auth0 validator
                    (JWKS verify, roles/scp -> scopes, per MCP_IDP_PROVIDER)
                              |
                    allow -> forward to real upstream MCP server
```

Two independent trust boundaries: the human's admin session (browser, interactive, revocable via IdP) and the agent's own M2M identity (Claude Code, self-refreshing, scoped independently). Neither is derived from the other.

## Components

### 1. `EntraJwtValidator` (implements existing `JwtValidator` interface)

- JWKS: `https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`
- Issuer: `https://login.microsoftonline.com/{tenant}/v2.0`
- Audience: the protected API app registration's Application ID URI
- `extractScopes()`: reads Entra's `roles` claim (App Roles, assignable to both users and service principals) and `scp` (space-separated delegated-scope string) — different shape from Auth0's flat `scope`/`permissions` array, requiring its own claims-mapping exactly as BL-019 anticipated.

### 2. Role-to-scope mapping (BL-029, folded into this work)

`role_mappings` config block maps Entra App Role names (e.g. `Tools.Write`) to internal scope strings (e.g. `tools:write`). Unmapped roles deny by default — fail-closed, consistent with existing project posture. Explicit scope grants remain backward compatible for Auth0 deployments (no change to that path).

### 3. `EntraIdpAdapter` (implements existing `IdpAdapter` interface)

- `createAgent`: `POST /applications` (Graph) -> `POST /servicePrincipals` -> assign app role -> `POST /applications/{id}/addPassword` for a client secret. Returns `client_id`+`client_secret` to the caller (see component 4).
- `deleteAgent`: `DELETE /applications/{id}`.
- `vendToken`: standard `client_credentials` POST to `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`, `scope=api://{apiAppId}/.default`.
- Credentials: plain `client_secret` for the management app doing these Graph calls (not certificate-based) — matches both the existing Auth0 M2M pattern and what was observed as standard practice elsewhere.
- Config: `MCP_IDP_PROVIDER=entra`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET` (management app), `ENTRA_API_APP_ID` (protected API app) — same shape as existing `AUTH0_*` vars.

### 4. Complete BL-048: surface `client_secret` from `/agents.html`

The create-agent flow already calls `IdpAdapter.createAgent` (Auth0 today, Entra once component 3 lands) and gets back a `client_secret` — it just needs to render it to the operator (one-time display, clearly labeled as non-retrievable afterward, per BL-048's existing acceptance note on credential-handling tradeoffs). This is IdP-agnostic — same UI change serves both providers, and is what actually retires the copy-a-JWT workaround: the operator configures Claude Code's `headersHelper` with `client_id`+`client_secret` once, and it self-refreshes via `/token` indefinitely, no browser step ever again.

### 5. `scripts/entra-setup.sh` — scripted one-time tenant setup (new, goes beyond Auth0 parity)

`docs/auth0-setup.md`'s one-time dashboard setup (Part 1: create API, define permissions, enable RBAC, create SPA, create management app) is entirely manual portal click-through today — there's no equivalent automation for Auth0 either. For Entra, that same one-time setup can be scripted with `az cli`/`az rest` (Graph API), since Entra's CLI surface is more complete than clicking through Auth0's dashboard by hand:

- `az ad app create` — protected API app registration + the management app used for Graph calls
- `az rest --method PATCH .../applications/{id}` — define App Roles (`Tools.Read`/`Tools.Write`/`gateway:admin` equivalents) with `allowedMemberTypes: Application` so they're assignable to M2M service principals
- `az ad app credential reset` — client secret for the management app
- `az ad app permission add` + `az ad app permission admin-consent` — grant Graph permissions and consent non-interactively (works because the tenant owner running this script is the tenant admin in a dev tenant)
- `az ad sp create` — service principal for the protected API app

**Stays manual, one-time**: creating the Entra tenant itself (~5 min Azure Portal wizard) — tenant creation isn't a scriptable `az` operation for a standard workforce tenant. Everything downstream of "tenant exists" is scripted.

This produces a `docs/entra-setup.md` analogous to `docs/auth0-setup.md`, but leading with the script rather than a portal walkthrough, with the portal-driven steps documented only as the (smaller) fallback/manual path.

### 6. Login UI: config-driven single button

One "Sign in" button on the browser harness, styled and routed per whichever `MCP_IDP_PROVIDER` the deployment has active — Microsoft-branded button + Entra auth-code flow, or Auth0-branded button + Auth0 flow. No simultaneous two-tile picker (would imply concurrent-IdP trust, which BL-034 already rejected); a deployment offering both providers "at once" would mean two separately-configured deployments, not one instance trusting both.

## Data flow (end to end, agent token path)

Operator (logged in as `gateway:admin` via whichever IdP) creates an agent in `/agents.html` -> `EntraIdpAdapter.createAgent` (Graph API: app + service principal + role assignment + secret) -> UI displays `client_id`+`client_secret` once -> operator drops these into Claude Code's local `headersHelper` config -> on every connect/reconnect, the helper POSTs `client_credentials` to `/token` -> `EntraIdpAdapter.vendToken` returns a short-lived Entra JWT -> guard proxy validates via `EntraJwtValidator` (JWKS, roles -> scopes) -> allow/deny/pending per existing `ToolGuard` logic, unchanged -> forwards to upstream MCP server on allow.

## Error handling

- Invalid/expired Entra token -> existing 401/deny-and-audit path, no `ToolGuard` changes needed.
- Unmapped Entra role -> deny by default (fail-closed, per BL-029).
- Graph API failures during `createAgent`/`deleteAgent` -> surfaced as a clear error in `/agents.html`, not silently swallowed (matches existing Auth0 error handling in that flow).
- Startup: unrecognized `MCP_IDP_PROVIDER` or missing required config for the selected provider -> fail-closed startup error, per BL-034's existing decision (no silent fallback).

## Testing

- Unit tests for `EntraJwtValidator.extractScopes()` against sample Entra token claim shapes (`roles`, `scp`), mirroring existing Auth0 validator test structure.
- Unit tests for `EntraIdpAdapter` against mocked Graph API responses (create/delete/vend).
- `npm run check:demo-policy`-equivalent parity check extended only if `guard_config.yaml` gains Entra-specific fields.
- No new deployed/e2e smoke test in this phase — an Entra leg can be added to BL-024's CI matrix job later, once a real Entra tenant is live in CI, following the same pattern already planned for the Keycloak leg.

## Explicitly out of scope

- Keycloak adapter (BL-041) — skipped per the Decision above.
- Any human-delegated OAuth flow for Claude Code (RFC 8414/9728 resource-server metadata, Claude Code's native browser-popup PKCE) — confirmed unnecessary since agents keep their own M2M identity, never a human-derived token.
- A custom OAuth Authorization Server broker (DCR, opaque session tokens) — that pattern solves for arbitrary third-party clients doing self-service registration against a resource you don't control; this project controls its one agent client (Claude Code) directly, so pre-registration + `client_credentials` is sufficient.
- Per-user audit attribution (BL-030) — natural follow-on once human Entra login exists, but not required for this phase; left as a separate backlog item.
- OpenTelemetry extension — separate, later spec.
- Concurrent multi-IdP trust in one deployment — already rejected by BL-034.

## Backlog updates to apply once this spec is approved (and after `docs/mcp-authorization-research` merges)

- **BL-021**: mark in-progress / implement per this spec; drop any "concurrent trust" language per BL-034.
- **BL-029**: implemented as part of BL-021 in this spec (folded in, not a separate follow-on).
- **BL-041**: add a note that it was deliberately skipped in favor of going straight to Entra (owner's call — the abstraction was already Auth0-proven and interface-complete), rather than silently dropping it.
- **BL-048**: re-scope acceptance text to the generic (IdP-agnostic) `client_secret`-surfacing described in Component 4; this is the actual fix for the copy-paste problem.
- **BL-027 / BL-028**: revise or close — the stdio-shim + human-delegated-Entra-SSO-token-acquisition framing no longer applies once agents use their own M2M identity over the existing HTTP transport; note the reasoning (native Claude Code OAuth exists but isn't the right layer here) rather than deleting silently.
- **BL-049**: leave open/lower priority — `gateway:admin` friction is a separate, still-unscoped human-login concern, not solved by this spec.
- **BL-052**: close with the research finding recorded (Claude Code has native MCP OAuth support; not adopted here because the agent-identity model, not human-delegated OAuth, is the right fit for this project's agents).

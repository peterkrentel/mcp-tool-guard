# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **`docs/superpowers/specs/2026-08-08-entra-idp-and-agent-tokens-design.md` and `docs/superpowers/plans/2026-08-08-entra-idp-and-agent-tokens.md`** — the design spec and implementation plan that drove this branch's Entra IdP work, committed after the fact (they existed and were used throughout implementation but were left untracked until the final whole-branch review caught it).

- **`scripts/entra-setup.sh` — scripted one-time Entra tenant setup** — bash script that automates Entra app registrations, App Roles, and M2M agent provisioning via the `az` CLI (prerequisite: an existing Entra tenant and `az login` session), printing environment variables (`ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET`, `ENTRA_API_APP_ID`, `VITE_ENTRA_*`) for the operator to copy into `scripts/dev.env` and `ui/.env.local`. Replaces the manual Azure Portal click-through workflow (documented in `docs/auth0-setup.md` for Auth0) with a scriptable alternative for Entra deployments.
- **Entra ID `roles` claim support in `extractScopes()`** — `gateway/guard.ts`'s `DefaultJwtValidator.extractScopes()` now reads Entra's `roles` claim (array of strings, equivalent to Auth0's `permissions`) in addition to the existing `scope`, `scopes`, `scp`, and `permissions` claims. Roles are merged with other scopes and deduplicated, enabling Microsoft Entra ID as a second identity provider without requiring custom scope-extraction logic.
- **`EntraTokenVendor` for Entra ID M2M token vending** — `gateway/entra-token-vendor.ts` provides client_credentials token exchange for Microsoft Entra ID, mirroring `gateway/token-vendor.ts` (Auth0) with an in-memory token cache (60s skew) and invalidation support. Exported factories: `entraTokenVendorFromEnv()` reads `ENTRA_TENANT_ID`; `entraApiAppIdFromEnv()` reads `ENTRA_API_APP_ID`. Task 3's `EntraIdpAdapter` uses these to vend scoped M2M tokens for Entra-backed agents.
- **Entra Graph API M2M agent lifecycle** — `gateway/entra-mgmt.ts` mirrors `gateway/auth0-mgmt.ts`'s M2M agent create/delete lifecycle but drives Microsoft Graph: `createEntraAgent()` resolves the protected API's service principal (object id + App Roles) once, registers an app, creates its service principal, assigns one App Role per requested scope (using the API's servicePrincipal object id as `resourceId` and each role's GUID `id` — not the scope string — as `appRoleId`, per Graph's `appRoleAssignments` contract), and mints a client secret; any mutating step failing after app creation rolls back by deleting the just-created application (Graph cascades this to its service principal and role assignments), mirroring `auth0-mgmt.ts`'s rollback-on-grant-failure. `deleteEntraAgent()` resolves the app's Graph object id from its `appId` (client_id) and deletes it. Requires `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_API_APP_ID`. Task 4's `EntraIdpAdapter` will use these directly.
- **`EntraIdpAdapter` wired into `buildIdpAdapter()`** — `gateway/idp-adapter.ts` now exports `EntraIdpAdapter` (implementing the `IdpAdapter` interface, mirroring `Auth0IdpAdapter`), and `buildIdpAdapter("entra")` returns a working instance instead of throwing "not yet implemented". The adapter bridges the gateway's generic agent-lifecycle/token-vending operations to Entra's Graph API by delegating to Task 2's `EntraTokenVendor` and Task 3's `createEntraAgent`/`deleteEntraAgent`.
- **`research/` folder** — background research on where tool-call authorization for agentic AI is
  supposed to live across deployment types (local MCP client, browser agent, enterprise backend
  agent, managed/hosted agent), with cited findings on the MCP authorization spec's scope,
  OWASP's Agentic AI / LLM Top 10 framing of "excessive agency," what real AI-gateway products
  (Cloudflare, Kong, Portkey, LiteLLM) actually enforce vs. market, and where this project's
  approach is and isn't differentiated against that landscape. Not project documentation —
  background material for reasoning about the wider ecosystem this project sits in.
  `research/positioning.md` was subsequently fact-checked line-by-line against `gateway/*.ts`,
  `servers/flight/guard*.py`, and `docs/*.md`, then recalibrated a second time after review: the
  design actually has three separate credential layers (agent JWT → proxy; the proxy's own
  `upstream_token` → the real MCP server, so the agent's identity never reaches upstream; a
  one-time opaque approval token for human-in-the-loop escalation of a scope-denied call), and two
  things earlier flagged as "gaps" — no three-way scope intersection, and the approval queue being
  opt-in — are actually correct design for a service-agent (M2M) model with a deliberate
  fail-closed default, not thinness. The one enforcement-layer asymmetry that remains (the flight
  demo server's embedded guard has no revocation check or approval-queue equivalent) is because
  `servers/flight/` was this project's original proof-of-concept, predating both features, which
  were added later to the TS proxy only and never backported — an artifact of build order, not an
  unexplained inconsistency.
- **`kvMget` batch-fetch primitive** (`gateway/kv.ts`) — one Redis `MGET` command for N keys instead of N individual `GET` commands. Verified against Upstash's official REST API docs (`/mget/{key1}/{key2}/...` path, `{"result": [...]}` response, null for missing keys, same order as requested).
- **`client_secret` surfaced once in `/agents.html` create-agent flow (BL-048)** — `ui/src/agents-main.ts`'s `createAgent()` call already got a `client_secret` back from the server, but it was discarded (`clientSecret: ""`) instead of shown to the operator, leaving no way to recover the M2M credential after creation. `ActiveAgent` gained a `secretShown` flag; the create-agent handler now keeps the real secret and `renderAgentCards()` displays it exactly once in a `.card-secret-warning` box with "Copy" (clipboard API) and "I've saved it" buttons — clicking the latter clears `clientSecret` from memory and flips `secretShown` so it can never render again, including across re-renders. Agents loaded from `listAgents()` (an existing session, not a fresh creation) are marked `secretShown: true` since the server never returns a secret for those. New `.card-secret-warning` CSS added to `ui/styles.css` alongside the existing `.card-meta` rules.
- **Config-driven single sign-in button (`ui/src/auth.ts`, `@azure/msal-browser`)** — the `agents.html` operator sign-in flow was hardwired to Auth0 (`@auth0/auth0-spa-js`); `auth.ts` now also implements the equivalent MSAL-backed flow for Microsoft Entra (`getMsalClient()`, `isEntraAuthenticated()`, `loginWithEntra()`, `logoutEntra()`, `getEntraAccessToken()`, `getEntraUserLabel()`, plus `tokenHasEntraRole()`/`rolesFromAccessToken()` reading the Entra JWT's `roles` claim instead of Auth0's `permissions`), and a new `getIdpProvider()` (backed by a standalone, unit-tested `normalizeIdpProvider()` in `ui/src/auth-provider.ts`, defaulting to `"auth0"`) selects between them via `VITE_IDP_PROVIDER`. Generic dispatcher functions — `login()`, `logout()`, `isSignedIn()`, `getAccessToken()`, `getUserLabel()`, `getIdpConfig()`, `getSignInLabel()`, `hasGatewayAdminAccess()` — pick the right provider under the hood; `ui/src/agents-main.ts`'s `syncAdminUi()` now calls these generic names instead of the Auth0-specific ones directly, and sets the login button's label from `getSignInLabel()` so it reads "Sign in with Microsoft" or "Sign in with Auth0" depending on configuration. The existing `handleAuthRedirect()` (previously Auth0-only) was replaced, not duplicated, so it now dispatches Entra's `handleRedirectPromise()` (run lazily inside `getMsalClient()`) or Auth0's `handleRedirectCallback()` depending on provider.

### Changed

- **Backlog: BL-021 marked done** — removed the completed `BL-021` (Azure Entra JWT validation and IdP adapter) entry from `backlog.md`'s open P0 list per the file's own completed-item rule; see the `EntraTokenVendor`/`EntraIdpAdapter`/`entra-mgmt.ts`/`extractScopes()` entries above for the shipped implementation. No lingering "concurrent trust" wording was found on this item — that language was already dropped in the BL-034 single-active-provider pass.
- **Backlog: BL-029 marked done** — removed the completed `BL-029` (Entra role-to-scope mapping) entry from `backlog.md`'s P1 list; implemented as part of BL-021 rather than as a separate `role_mappings` config/translation layer — Entra App Roles are named identically to existing scope strings, so `DefaultJwtValidator.extractScopes()`'s `roles` claim support (above) maps them for free. Unmapped roles simply aren't present in a token's `roles` claim, so `ToolGuard`'s existing scope-check already denies them by default; no separate mapping/translation code was needed.
- **Backlog: BL-041 deprioritized (not done, kept open)** — `backlog.md`'s `BL-041` (Keycloak `JwtValidator`/`IdpAdapter`) status changed to `deferred` with a note explaining the decision: this project went straight to Entra instead of Keycloak-first, because the `JwtValidator`/`IdpAdapter` abstraction was already interface-complete and Auth0-proven, so Keycloak-first de-risking wasn't actually needed before taking on Entra. Row kept in place (not deleted) since the work itself remains legitimate future scope.
- **Backlog: BL-048 marked done** — removed the completed `BL-048` (surface `client_secret` from `/agents.html`) entry from `backlog.md`'s P1 list; see the `client_secret` entry above for the shipped implementation.
- **Backlog: BL-052 marked done** — removed the completed `BL-052` (research non-interactive credential refresh in the MCP/agent ecosystem before committing to a custom design) entry from `backlog.md`'s Deferred list. Research finding: Claude Code's own MCP client does have native OAuth support for remote HTTP MCP servers (RFC 8414/9728 discovery, PKCE, a one-time browser popup, OS-keychain token caching, and silent refresh) — but it's a human-delegated-auth flow, and this project's agents (Claude Code included) authenticate with their own M2M `client_credentials` identity instead, which is the right fit for a service-agent model, not a human-delegated one. Native Claude Code OAuth was deliberately not adopted here for that reason.
- **Backlog: BL-030's `depends_on` updated** — dropped the now-satisfied `BL-021` dependency from `BL-030` (per-user audit attribution) since Entra is shipped; `BL-030` remains open/blocked on `BL-005`/`BL-020`.
- **`backlog.md` formatting fix** — restored a blank-line separator before the `## Notes` section that the BL-052 row removal above had accidentally consumed.

### Removed

- **BL-027/BL-028** (Claude Desktop stdio transport shim + human-delegated Entra SSO token acquisition for it) — superseded by the M2M-agent-identity model this release ships: Claude Code already gets its own token via `client_credentials` over the existing HTTP transport (`headersHelper`), so neither a stdio bridge nor a human-delegated OAuth flow is needed. Rows removed from `backlog.md`.

### Changed

- **KV command usage fix (BL-044-adjacent)** — `gateway/pending-store.ts`'s `listPendingRequests` and `gateway/agent-store.ts`'s `listAgents` both did a `SCAN` followed by one individual `GET` per matching key (an N+1 pattern) — replaced with `kvScan` + a single batched `kvMget`. This is what actually caused the Upstash free-tier quota exhaustion on 2026-07-21: combined with 2-5s UI polling intervals, every poll cost `1 + N` commands where N grows with however many records have ever accumulated (no pruning yet, that's BL-044's separate remaining scope).
- **UI poll intervals reduced** — `ui/src/agents-main.ts`'s audit poll (2s→10s) and pending poll (5s→15s); `ui/src/claude-ops-main.ts`'s combined pending+audit poll (2s→10s). A human-watched dashboard doesn't need sub-10-second refresh, and this alone cuts command volume roughly 4-7x on top of the batching fix.
- **Ephemeral k3d's KV shim kept in sync** — `deploy/ephemeral/kv-rest-adapter/server.mjs` only implemented `/get`, `/set`, `/del`, `/scan` (mirroring whatever `gateway/kv.ts` needed when it was first written), so it had already drifted behind the new `kvMget` call and would have failed if exercised. Added a `/mget/*` route (`redis.mGet`, matching Upstash's real response shape). Also added a `GET /agents` check to `scripts/smoke-auth0-k3d.sh` (asserting the newly created ephemeral agent appears in the list) so this class of change actually gets exercised by CI going forward — previously the smoke script never called the list endpoints at all, so this whole code path was untested by the ephemeral lane despite it being intended as the pre-deployment validation gate.

- **Claude Code prod workflow now uses dynamic token minting** — `docs/claude-code-demo.md` updated to use the same `scripts/claude-mcp-token-helper.sh` script for both local dev and prod, configured via `MCP_AGENT_CLIENT_ID`/`MCP_AGENT_CLIENT_SECRET` environment variables pointing to a prod agent, instead of the static-token workaround. This is now possible because BL-048 surfaced the `client_secret` in `/agents.html`, enabling the usual `client_credentials` flow without manual DevTools steps. Deleted `scripts/claude-mcp-token-helper-prod-demo.sh` — no longer needed. (The doc edit itself landed in a small follow-up commit after task review caught it staged-but-uncommitted in the original commit.)
- **Landing page sign-in** — `ui/index.html` now has working Sign in/Sign out controls (`ui/src/landing-main.ts`), matching the other pages. Previously the landing page had zero JavaScript at all and couldn't reflect auth state or process an Auth0 callback.
- **Upstash plan/quota guidance in `docs/vercel-deploy.md`** — documents that Vercel's Storage tab doesn't show KV usage/plan (only a "Connect" action); the actual Upstash console is where to check quota and upgrade plans. Notes the Free tier's 500K commands/month cap and why Pay as You Go is the practical fix for this project's usage pattern.
- **`docs/entra-setup.md` — Entra ID operator setup guide** — comprehensive guide mirroring `docs/auth0-setup.md`'s structure but adapted for Microsoft Entra ID: portal-only tenant creation prerequisite, `scripts/entra-setup.sh` automation path (script output → env var mapping), local dev (gateway + UI env files), token verification (via JWKS / `roles` claim), Vercel deployment, and troubleshooting (including the "App Role not assignable" `allowedMemberTypes` gotcha). Updated `docs/identity.md` with a new "Entra ID setup (shipped 0.5.0)" subsection explaining the single-active-provider model and cross-linking to the new guide and BL-034's design rationale.

### Fixed

- **Auth0 login redirect regression** — `ui/src/auth.ts`'s `redirect_uri` was hardcoded to `window.location.origin` (no path), so login always redirected back to `/` regardless of which page initiated it. Before the landing-page change this worked by accident (`/` used to be the flight demo, which could process the callback); after `/` became a static page with no auth handling, the callback's `code`/`state` went unprocessed and login silently never completed, on any page, in any browser (confirmed identical in incognito). Fixed to `window.location.origin + window.location.pathname` so login returns to the originating page. **Requires an Auth0 dashboard change**: Allowed Callback URLs must now include each specific page path (e.g. `/agents.html`, `/claude-ops.html`, `/flight-demo.html`), not just the bare origin.
- **`.auth-controls[hidden]` had no effect** — `styles.css`'s `.auth-controls { display: flex; ... }` had no `[hidden]`-aware override, so CSS specificity beat the native `hidden` attribute and the sign-in controls stayed visible even when JS explicitly tried to hide them (e.g. `/agents.html`/`/claude-ops.html`'s "control plane auth is off" branch, which hides the controls and skips the auth-redirect handling entirely). Made the visible-but-nonfunctional Sign In button on those pages look broken when local admin auth was actually just intentionally disabled. Added `.auth-controls[hidden] { display: none; }`.

- **`claude-code-demo.md` Setup section** — documents, for the first time, exactly how `ghprod` got registered against prod: sign in as admin on `/agents.html`, create the M2M agent, grab the `clientSecret` from DevTools (BL-048), mint a token via `POST /token`, store it as `MCP_PROD_STATIC_TOKEN`, then `claude mcp add-json ghprod ...`. Previously this doc assumed `ghprod` pre-existed and never showed the setup, unlike `claude-code-integration.md`'s local equivalent. Doubles as a template for wiring up a different MCP server the same way.
- **`claude-code-demo.md` "The bigger picture" note** — makes explicit that this project addresses one deliberate slice of "securing Claude Code" (MCP tool-call governance), not the whole problem, and that it's a raw work in progress — naming the session's own rough edges (static token, admin-only control-plane routes, BL-050) as evidence rather than glossing over them.
- **BL-050** — re-filed "guard proxy should normalize upstream MCP response framing (SSE vs plain JSON)" under a fresh number. Originally filed as BL-048 on an unmerged branch (`docs/bl-048-mcp-response-normalization`); that number collided with BL-048 being independently used for the clientSecret-surfacing gap during the repo cleanup PR, stranding the original entry.
- **Landing page doc links** — each card on `ui/index.html` now has a small secondary link to its most relevant doc (`guard-proxy.md`, `claude-code-demo.md`, `demo-proxy.md`).
- **BL-051** — filed live: denying a pending `create_or_update_file` request didn't stop the call from being retried. The proxy's own deny logic is confirmed correct in isolation (verified via dual-logged deny rows terminating the held connection cleanly), but a brand-new trace_id and pending request appeared ~2s later for what was one single explicit tool call, eventually getting approved and completing. Root cause not yet identified — candidates are Claude Code's own transport-level retry, or the long-poll's deny path not returning a clean enough response to prevent client-side retry.
- **BL-052** — filed: research how the MCP/agent ecosystem already handles non-interactive credential refresh for remote MCP servers (Claude Code's own MCP client, the MCP spec itself, other clients like VS Code/OpenCode) before committing to a custom guard-side token-vending design for BL-048/BL-049.
- **Remaining Auth0-only call sites in `agents-main.ts` made provider-generic** — the prior config-driven sign-in work explicitly left three call sites hardwired to Auth0: `setAdminTokenProvider`'s callback (the actual bearer-token supplier for admin API calls — create agent, add MCP server, etc.) always returned `null` under `VITE_IDP_PROVIDER=entra`, meaning every admin action would silently go out unauthenticated and get rejected server-side even when correctly signed in via Entra with `gateway:admin`. Fixed to use the generic `getIdpConfig()`/`isSignedIn()`/`getAccessToken()`. Also fixed `loadControlPlaneAuthFlag()`'s catch-fallback (`getAuth0Config()` → `getIdpConfig()`) and `initBtn`'s client-side `GatewayAgent` JWT-trust pre-check wiring, via a new generic dispatcher `jwtTrustFromIdpConfig()` in `ui/src/auth.ts` (returns Entra or Auth0 trust config depending on `getIdpProvider()`, or `{}` if neither is configured) replacing the inline Auth0-only logic.

### Fixed

- **Clipboard copy failure for one-time `client_secret` display** — `ui/src/agents-main.ts`'s copy-secret button handler was calling `navigator.clipboard.writeText()` but discarding the returned promise entirely, so if the copy failed (permission denied, non-secure context, browser quirk), the operator received no feedback, saw no error, and might believe the secret was on their clipboard, click "I've saved it," and permanently lose the only copy. Added a `.catch()` handler that surfaces the failure to `statusEl` with a message directing the operator to manually copy the secret instead, so they won't proceed to dismiss the warning until they've actually secured the credential.

- **`claude-code-prod` agent drift** — discovered live (by decoding a freshly vended token's claims) that the Auth0 application named `claude-code-prod` had drifted to `slack:read`/`slack-prod` at some point, unrelated to its name or to `ghprod`. Revoked and recreated fresh with `github`/`repo:read`; `docs/claude-code-demo.md` and `docs/auth0-setup.md` updated to reflect the corrected, current state — `claude-code-prod` (Claude Code) and `github-prod` (browser demo) are now two distinct, correctly-scoped agents. `scripts/dev.env`'s `MCP_PROD_STATIC_TOKEN` updated to the new token.

- **New UI landing page** (`ui/index.html`) — root now shows a minimal title/description page linking to Agent gateway, Claude Code ops, and Flight demo (POC), instead of defaulting straight into the flight chat POC. Flight demo moved to `ui/flight-demo.html`; nav bar across all 4 pages updated to the new order and labels, each page's tagline doubles as a one-line role caption. `ui/vite.config.ts`'s dev proxy and build inputs updated accordingly. Implements `docs/superpowers/specs/2026-07-20-repo-cleanup-and-landing-page-design.md`.
- **BL-046, BL-048 backlog rows** — filed proper `backlog.md` entries for two items already referenced in shipped docs (`claude-ops-view-design.md`, `claude-code-demo.md`) but missing their own row.
- **Auth0 tenant application inventory** — `docs/auth0-setup.md` now documents which apps in the shared Auth0 tenant are load-bearing vs safe to delete, after the tenant hit its free-tier `too_many_entities` limit and blocked CI. Confirms `mcp-tool-guard-proxy-m2m` (not `Default App`) is the real Management API client, based on its actual API Access Policies grants rather than its name.
- **BL-049** — filed, not yet scoped: local `/claude-ops.html` testing currently requires manually copying an Auth0 access token out of the browser into `scripts/dev.env`, which isn't a sustainable workflow.
- **`docs/entra-setup.md` / `docs/identity.md` — corrected JWT-trust env-var claims, App-Role troubleshooting, added env-var reference table** — Step 5 previously claimed the flight server derives the issuer/JWKS URLs from `ENTRA_TENANT_ID`/`ENTRA_API_APP_ID`; in fact `gateway/env.ts`'s `jwtTrustFromEnv()` and `servers/flight/guard.py`'s `JwtTrustConfig.from_env()` require `MCP_JWT_ISSUER`/`MCP_JWT_AUDIENCE` set explicitly, and only auto-derive `MCP_JWT_JWKS_URL` via `${issuer}/.well-known/jwks.json` — a formula that happens to be correct for Auth0 but wrong for Entra (whose real JWKS endpoint is `https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys`), so Entra deployments must set all three explicitly. Fixed Step 5, the Vercel flight-env table, and `identity.md`'s Entra subsection to match. Also fixed the troubleshooting row conflating two distinct "App Role not assignable to service principal" cases: a genuine M2M-assignable role (`flights:*`/`repo:*`) missing `allowedMemberTypes: ["Application"]` (re-running the PATCH step is the fix) vs. attempting to assign `gateway:admin` — intentionally `allowedMemberTypes: ["User"]`-only per `scripts/entra-setup.sh` — to a service principal, which fails by design and should route to a human user instead. Added the standalone env-var reference table (`ENTRA_*`, `MCP_IDP_PROVIDER`, `VITE_*`) specified by the original task brief but missing from the shipped doc.
- **Entra setup script reconciled with runtime auth code (final whole-branch review, batch A)** — `scripts/entra-setup.sh`, `ui/src/auth.ts`, and `docs/entra-setup.md` were written independently and never checked against each other or a real tenant; this batch fixes five compounding mismatches:
  - **Token version / audience mismatch** — the script never set `api.requestedAccessTokenVersion`, so Entra defaulted to v1 tokens, but `jwtTrustFromEntra()` and the docs assumed v2-shaped `aud: api://<guid>`. The script now PATCHes `api.requestedAccessTokenVersion: 2` on the API app; `jwtTrustFromEntra()`'s `jwtAudience` changed to the bare GUID (v2's actual `aud` shape); docs updated everywhere an audience value is shown. `gateway/entra-token-vendor.ts`'s `.default` scope *request* string is unaffected — request-scope syntax and the resulting `aud` claim are different things.
  - **SPA had no permission to request the API's scope** — `loginWithEntra()` requested `api://<id>/.default` in a delegated flow, but the script only defined `appRoles` (Application/M2M permissions), never a delegated `oauth2PermissionScopes` entry or an SPA grant — Entra rejects this with `AADSTS650057`. Script now defines a delegated `access_as_user` scope (admin-consent-required), grants it to the SPA app (`az ad app permission add ... =Scope`), and admin-consents it; `loginWithEntra()`/`getEntraAccessToken()` now request that named scope instead of `.default`.
  - **Redirect URI mismatch** — the script registered exactly `http://localhost:5173`, but `getMsalClient()` actually redirects to `.../agents.html`, and Entra requires an exact match. Script now registers `http://localhost:5173/agents.html` and the prod `https://mcp-tool-guard-ui.vercel.app/agents.html`; troubleshooting row corrected (cross-referenced against the identical Auth0 callback-URL bug that already happened once in this project).
  - **Docs told operators to assign M2M-only roles to a human test user** — `flights:*`/`repo:*` App Roles were `allowedMemberTypes: ["Application"]`-only, so they couldn't appear in the portal's user-assignment picker despite Step 6 telling operators to assign them to a test user. Changed to `["User", "Application"]` (dual-assignable); `gateway:admin` deliberately stays `["User"]`-only.
  - **Missing Slack scopes** — `gateway/config.yaml` defines `slack:read`/`slack:write` but the script's App Role list (which claims to stay in sync with that file) omitted them; added, dual-assignable, with descriptions.
  - Also corrected the Vercel flight-env table and a troubleshooting row that listed `MCP_IDP_PROVIDER`/`ENTRA_TENANT_ID`/`ENTRA_API_APP_ID` as flight-project env vars — `servers/flight/guard.py` only ever reads the three generic `MCP_JWT_*` vars; those `ENTRA_*` vars are gateway/proxy-side only.
  - Not yet verified against a live Azure tenant (none available in this environment) — internal consistency across the script/code/docs was checked by re-reading all three files together, but an actual `az login` + sign-in test is still outstanding.
- **Backend enforcement gaps: flight guard `roles` claim, M2M revocation via `azp`/`appid`, OData filter escaping (final whole-branch review, batch B)** — three findings in the TS/Python enforcement layers and the Entra management client, found by comparing the two independently-extended IdP code paths against each other:
  - **`servers/flight/guard.py` never learned Entra's `roles` claim** — `gateway/guard.ts`'s `DefaultJwtValidator.extractScopes()` was extended earlier in this branch to merge Entra's `roles` claim into scopes, but its Python mirror, `FlightToolGuard.extract_scopes()`, was never given the equivalent change, so every flight-server tool call under Entra was denied with zero scopes even though the JWT carried `roles`. Added the same merge+dedupe branch to the Python side.
  - **Entra M2M agents bypassed immediate revocation** — `clientIdFromPayload()` in `gateway/guard.ts` only recognized Auth0 M2M token shapes (`client_id` claim, or `sub` matching `<id>@clients`), so it returned `null` for every Entra `client_credentials` token, whose client/application ID lives in `azp` (v2) or `appid` (v1) instead. Because `isM2mLikeToken()` (and therefore `assertActiveM2mAgent()`) never fired, an Entra M2M agent deleted via `DELETE /agents/:clientId` kept working with its already-vended token until natural expiry, unlike an Auth0 agent. Extended `clientIdFromPayload()` to check `azp`/`appid` as unambiguous provider-specific primary signals, ahead of Auth0's `@clients`-suffixed `sub` fallback heuristic; no `gty`-equivalent secondary signal was needed for Entra. `JwtPayload` (`gateway/types.ts`) gained `appid?: string` alongside its existing `azp?: string`.
  - **OData filter injection in `gateway/entra-mgmt.ts`** — `getApiServicePrincipal()` and `deleteEntraAgent()` both built a Microsoft Graph `$filter` query by interpolating a value into an `eq '<value>'` string literal after only `encodeURIComponent()`-encoding it, which doesn't escape a literal single quote inside the OData literal's own syntax. Since `deleteEntraAgent()`'s `clientId` comes straight from the `DELETE /agents/:clientId` URL path (`/^\/agents\/([^/]+)\/?$/` permits quote characters), a crafted client ID could broaden the filter to match an unintended application and delete it. Added `escapeODataString()` (doubles `'` per OData string-literal escaping rules) and applied it at both interpolation sites, in addition to the existing `encodeURIComponent()`.

### Changed

- **BL-038 moved to `## P1 (important)`** — its own `priority:` field already said P1; it was filed under the `## P0 (next)` header by mistake. No content change.
- **`examples/python-agent`** — fixed tool names (`search_flights`/`create_booking` → `search_flights_tool`/`create_booking_tool`, matching `servers/flight/server.py`) and swapped the README's reference to a nonexistent `full_access` demo token for the real `booking` key.
- **Stale flight-at-root doc references** — `docs/ARCHITECTURE.md`, `docs/NEXT-STEPS.md`, `docs/deploy-overview.md`, `docs/demo-proxy.md`, `docs/render-deploy.md`, `README.md` still pointed readers at `/`/`index.html` for the flight demo after it moved to `flight-demo.html`; updated. Second pass caught 2 more: `docs/ARCHITECTURE.md`'s "Today vs next" table (2 cells) and `CLAUDE.md`'s own FlightAgent description.

### Removed

- **Junk root scratch files** — `firstslice.md`, `new-pat-local.md`, `prod-smoke-sliceB.md`, `smoke-pat-prod.md`.

### Security

- **Redacted screenshot PII** — cropped real personal browser chrome (bookmarks bar, tabs) out of 7 `docs/images/demo/*.png` files, and blacked out a real personal email address baked into the app UI itself in 2 of them (`claude-code-ops-approval.png`, `prod-ui-audit-success.png`).
- **Redacted named-colleague reference** — `CHANGELOG.md` and `backlog.md`'s BL-047 note referred to a specific internal colleague by full name; reworded to a generic reference. No change to the underlying cross-project observation.

### Added

- **Claude Code prod demo doc** — `docs/claude-code-demo.md`, a from-scratch (no prior context assumed) walkthrough of driving the deployed Render guard proxy from Claude Code via a new `ghprod` MCP server entry and `scripts/claude-mcp-token-helper-prod-demo.sh` (a static pre-vended-token `headersHelper`, workaround for BL-048's missing `clientSecret`). Documents a real end-to-end run with three independent screenshots confirming the same trace id — `claude-code-ops-approval.png` (the guard's own ops UI, full-page capture including sign-in state and client-type filter), `claude-code-grafana-dashboard.png` (OTel/Grafana), `claude-code-render-logs.png` (raw Render process logs) — of a `repo:read`-only agent's `create_or_update_file` call denied on scope, held pending via the BL-045 long-poll, approved live through the Claude Code ops view, and forwarded to a real GitHub commit. Also covers how Claude Code discovers, selects, and invokes an MCP tool (namespaced tool names per server, on-demand schema loading, single JSON-RPC call per invocation), and a "what this proves vs. what's still open" assessment (including an explicit scope note pointing to `track2-github-proof.md`/`smoke-deployed.sh` as where the underlying guard mechanism was already proven, distinguishing that from what's new here — a real third-party client) for scoping next-phase work.
- **Nav links to Claude Code ops** — added to `/` and `/agents.html`'s site nav.
- **Claude Code ops view** — `ui/claude-ops.html` + `ui/src/claude-ops-main.ts`, an admin-gated page (same Auth0 `gateway:admin` sign-in as `/agents.html`) showing pending approvals and recent audit activity filtered by client type (Claude Code / browser GUI / unattributed), so an operator doesn't need to know to check `/agents.html` and hand-inspect trace-id strings. Implements `docs/superpowers/specs/2026-07-19-claude-ops-view-design.md`.
- **`classifyClientType()` helper** — `ui/src/client-type.ts`, classifies a trace id as `claude-code` (`cc-` prefix), `browser-gui` (`tr_` prefix), or `unattributed`, for the upcoming Claude Code ops view. Also fixes `ui/src/proxy-api.ts`'s `PendingRequest` interface, which was missing `trace_id`/`wait_for_approval` (both exist server-side since BL-045).
- **Claude Code ops view implementation plan** — added `docs/superpowers/plans/2026-07-19-claude-ops-view.md`, a step-by-step plan implementing the approved `docs/superpowers/specs/2026-07-19-claude-ops-view-design.md`. Plan only — implementation lands in subsequent commits.

- **Claude Code ops view design spec** — added `docs/superpowers/specs/2026-07-19-claude-ops-view-design.md`, scoping a new admin-gated ops page (`ui/claude-ops.html`) filtered by client type (Claude Code / browser GUI / unattributed, via the existing `cc-`/`tr_` trace-id prefix conventions) so a security/admin operator has one place to notice and approve pending MCP tool calls instead of needing to know to check `/agents.html` and hand-inspect trace ids. Design only — no code changes; implementation plan comes next.

- **Claude Code opts into pending-approval long-poll (BL-045)** — `scripts/claude-mcp-token-helper.sh` now sends `X-Wait-For-Approval: true`, so an approved write actually reaches GitHub instead of being lost — no user-facing config change required.
- **BL-045: pending-approval long-poll** — the guard proxy (`gateway/proxy-routes-mcp.ts`) now holds a write request open when the caller sends `X-Wait-For-Approval: true`, polling the pending record and forwarding the already-in-memory original request automatically once a human approves it via `/pending/:id/approve` — instead of requiring the caller to remember its own arguments and retry with an `X-Approval-Token`. Configurable via `MCP_PENDING_LONGPOLL_MAX_MS` (default 120000ms). The browser GUI's existing immediate-202-then-poll behavior is unchanged for callers that don't send the opt-in header.
- **BL-045 long-poll primitives** — `pendingLongPollMaxMs()` (`gateway/env.ts`) and `waitForPendingResolution()` (`gateway/pending-store.ts`), the building blocks for holding an MCP write open until a human approves it.
- **BL-037 closed out — Claude Code client Grafana dashboard live-verified** — `dashboards/grafana/mcp-tool-guard-claude-code-client.dashboard.json` was imported into the real Grafana Cloud instance as-is (no edits needed) and confirmed rendering real data: request/allow/deny/pending rate panels and a logs panel showing the exact `cc-b2723cd3-...`-correlated read-allow and write-deny/pending/approve events from the smoke test. Removed the completed `BL-037` entry from `backlog.md`'s open list per the file's own completed-item rule.
- **`claude-mcp-token-helper.sh` dev.env fallback (BL-037)** — the `headersHelper` now sources `scripts/dev.env` directly at call time if `MCP_AGENT_CLIENT_ID`/`MCP_AGENT_CLIENT_SECRET` aren't already in its environment. Claude Code invokes the script as a subprocess of its own already-running process, which only has the environment it was launched with — editing `dev.env` after launch previously had no effect without a full session restart. Discovered live during the BL-037 smoke test.
- **Claude Code integration guide (BL-037)** — `docs/claude-code-integration.md` documents actually-observed behavior connecting Claude Code as a real MCP client to the guard proxy: a clean read-allow, and a write call that hits scope-deny-then-pending simultaneously (approval queue was already enabled), times out client-side after Claude Code's ~300s MCP idle timeout with no visibility into the pending state, and — critically — is never actually forwarded upstream even after a human approves it via `/agents.html`, since the proxy never persists the original request arguments server-side and Claude Code has no retry-with-approval-token logic. Manually replaying the approved call confirmed the underlying deny→pending→approve→forward mechanism itself works correctly; the gap is purely client-compatibility. Also documents the `headersHelper` session-level (not per-call) trace-id limitation and the known mid-session token-refresh bug ([anthropics/claude-code#53267](https://github.com/anthropics/claude-code/issues/53267)).
- **BL-045 design: pending-approval long-poll for MCP-native clients** — added `docs/superpowers/specs/2026-07-19-pending-approval-long-poll-design.md`, recommending the guard proxy hold a write request open until a human approves it (opt-in via a new `headersHelper`-injected header) and auto-forward using the already-in-memory original arguments, instead of requiring the calling client to remember its own args and retry with an approval token. Design only — no gateway code changes; filed as `backlog.md`'s new BL-045.

### Changed

- **Extracted `renderPendingList()`** — `ui/src/pending-view.ts`, moved out of `ui/src/agents-main.ts`'s inline card-rendering so it can be shared with the new Claude Code ops view (next). Behavior-preserving — `/agents.html`'s approval queue panel is unchanged.
- **Backlog: added BL-047** — deferred, investigate-only cross-project note (not mcp-tool-guard implementation work): does an internal colleague's AI Proxy Engine log full LLM response content in its audit trail, the way mcp-tool-guard's own browser `GatewayAgent` already does in its chat/trace panel? Addressed in that project, not this one.
- **BL-045 status: implemented, pending prod verification** — gateway code and Claude Code opt-in shipped and live-verified locally; production `MCP_PENDING_LONGPOLL_MAX_MS` tuning against Render's real edge-timeout behavior remains open.
- **Backlog: BL-003 acceptance criteria expanded** — added a convenient list/delete mechanism for M2M agents (not just the raw `GET /agents`/`DELETE /agents/:clientId` API) to BL-003's cleanup-path requirement, noting the shape may differ between local (in-memory) and prod (KV-backed) storage. Noted after manually deleting the `claude-code-local` agent via hand-written fetch calls during BL-037 cleanup.

- **`IdpAdapter` interface extraction + Auth0 implementation (BL-020)** — `gateway/proxy-routes-agents-token.ts` now consumes agent create/delete/token-vend via an injected `IdpAdapter` interface (`gateway/idp-adapter.ts`) instead of calling `gateway/auth0-mgmt.ts`/`gateway/token-vendor.ts` directly; `Auth0IdpAdapter` wraps that existing code unchanged so behavior (status codes, error messages) is preserved exactly. New `MCP_IDP_PROVIDER=auth0|keycloak|entra` env var (default `auth0`) selects the single active provider at startup per the BL-034 design spec, failing loudly on an unrecognized or not-yet-implemented value. `/health` now reports `idp_provider`, `idp_management_configured`, and `idp_vending_configured` instead of `jwt_trust_enabled`/`auth0_mgmt_configured`. `IdpAdapter`, `IdpProviderId`, `CreatedAgentClient`, `VendedToken`, `Auth0IdpAdapter`, and `buildIdpAdapter` are exported from `gateway/index.ts` for future Keycloak (BL-041) and Entra (BL-021) implementations.
- **Deployed-proxy smoke validator** — `scripts/smoke-deployed.sh` verifies JWT scope enforcement end-to-end against the real deployed Render guard proxy: reuses existing read-only GitHub/Slack M2M agents (never creates new ones), proves read-allow + write-deny (never completing the write, even if it lands in the approval queue), and checks the `/audit` three-source correlation. Authenticates as a standing `gateway:admin` Auth0 test user via `scripts/auth0-headless-login.mjs` (a small Playwright script that drives the real `/agents.html` login form and reads the resulting token out of localStorage) — the account's Auth0 client only supports the Authorization Code flow, and realm-based ROPG was tried and consistently rejected across several client configurations, so this replays the actual login instead of a non-interactive grant. Added `playwright` as a root devDependency and a matching `.claude/agents/smoke-deployed.md` subagent. New required local env vars documented in `scripts/dev.env.example`: `SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD`.
- **`JwtValidator` interface extraction (BL-019)** — `ToolGuard` (`gateway/guard.ts`) now consumes JWT validation via an injected `JwtValidator` interface instead of implementing PEM/JWKS dual-trust verification internally; existing behavior (issuer-matched JWKS verification with M2M-agent liveness checks, PEM fallback, scope extraction/matching) is preserved in a new `DefaultJwtValidator` built automatically from the same constructor options. `JwtValidator`, `JwtValidatorOptions`, and `DefaultJwtValidator` are now exported from `gateway/index.ts` so future IdP-specific validators (Keycloak per BL-041, Entra per BL-021) can implement the interface from outside the package. `gateway/admin-auth.ts` and `gateway/proxy-routes-audit.ts` updated to call `guard.jwtValidator.validateToken`/`.hasScope` instead of the removed direct `ToolGuard` methods.
- **`CLAUDE.md` and project subagents** — added root `CLAUDE.md` for Claude Code guidance (commands, architecture, enforcement-layer distinctions, workflow rules); added `.claude/agents/jwt-scope-reviewer.md` (read-only reviewer for JWT scope validation patterns in TypeScript) and `.claude/agents/jwt-validator-extractor.md` (scoped implementer for BL-019, explicitly barred from IdP adapter code)
- **Ephemeral k3d CI deployment lane (additive)** — added isolated assets for running UI + guard in Kubernetes with self-hosted Redis and an in-cluster KV REST bridge compatible with existing `KV_REST_API_URL` usage: new Dockerfiles (`gateway/Dockerfile`, `ui/Dockerfile`), Helm chart under `deploy/ephemeral/helm/guard-ephemeral`, Auth0 smoke script (`scripts/smoke-auth0-k3d.sh`), dedicated workflow (`.github/workflows/k3d-ephemeral-auth0.yml`), and setup guide (`docs/ephemeral-k3d-ci.md`)
- **BL-034 design spec: single-active-IdP trust model** — added `docs/superpowers/specs/2026-07-18-idp-trust-model-design.md`, deciding that a deployment trusts exactly one active IdP (selected via a new `MCP_IDP_PROVIDER=auth0|keycloak|entra` env var driving both `JwtValidator` and `IdpAdapter` construction) rather than the originally-scoped concurrent multi-issuer trust; rejects concurrent-IdP support and per-server/tool issuer restriction as out of scope. Design only — no code changes; BL-020/BL-021/BL-041 implement against this decision.
- **BL-020 implementation plan** — added `docs/superpowers/plans/2026-07-18-bl-020-idp-adapter.md`, a step-by-step TDD plan for extracting an `IdpAdapter` interface (analogous to BL-019's `JwtValidator`) and wiring `MCP_IDP_PROVIDER` selection per the BL-034 spec. Plan only — implementation lands in subsequent commits on this branch.
- **BL-037 design spec: Claude Code guard integration** — added `docs/superpowers/specs/2026-07-19-claude-code-guard-integration-design.md`, deciding to smoke-test Claude Code against the locally-registered `github` server (not `flight`, which runs its own embedded guard and wouldn't demonstrate the proxy as sole enforcement point) via a new `scripts/claude-mcp-token-helper.sh` `headersHelper` script, and to document (not assume) the read-allow/write-deny/write-pending behaviors plus a real observability gap: Claude Code's tool calls have no per-call `trace_id`/`session_id` and never produce `source: "agent"` audit entries, since those are conventions of this project's own browser SDK that Claude Code has no knowledge of. The helper script tags its session-level trace id with a `cc-` prefix so Claude-Code-originated traffic is queryable in both the audit log and a new, separate Grafana dashboard (`dashboards/grafana/mcp-tool-guard-claude-code-client.dashboard.json` — additive, the existing live `mcp-tool-guard-proxy.dashboard.json` is not edited) filtered on the existing `mcp.trace_id` span attribute — no new telemetry code needed. Design only — no gateway code changes; this is a docs-plus-smoke-test task using entirely existing infrastructure.
- **BL-037 implementation plan** — added `docs/superpowers/plans/2026-07-19-bl-037-claude-code-integration.md`, grounded in a live test of `claude mcp add-json` (confirmed `headersHelper` is accepted, config lives in `~/.claude.json` under `local` scope — no repo file needed) and the exact `403`/`202` JSON-RPC response shapes already in `gateway/http-helpers.ts`. Flags Task 5 (the Grafana dashboard) as a manual, human-only step — no agent in this session has live Grafana Cloud UI access — and recommends inline execution over subagent dispatch for Tasks 2–3 since they configure and exercise this specific live Claude Code session's own MCP connection.
- **BL-037 Task 1: Claude Code MCP auth helper script** — `scripts/claude-mcp-token-helper.sh`, a `headersHelper` for Claude Code's `.mcp.json` that vends a client_credentials token from a local M2M agent (`POST /token`) and tags the session with a `cc`-prefixed trace id; uses `node`'s built-in `fetch` rather than shelling out to `curl`. Also added the net-new Grafana dashboard `dashboards/grafana/mcp-tool-guard-claude-code-client.dashboard.json` (existing `mcp-tool-guard-proxy.dashboard.json` untouched), authored directly against the real datasource names/query syntax (`grafanacloud-traces`/TraceQL, `grafanacloud-logs`/LogQL) pulled from that existing dashboard.

### Changed

- **Backlog: BL-024 marked done** — removed the completed `BL-024` (Dockerfiles + k3d ephemeral CI workflow, already shipped as `.github/workflows/k3d-ephemeral-auth0.yml` plus numerous follow-up hardening entries in this same changelog) entry from `backlog.md`'s open P0 list per the file's own completed-item rule; dropped the now-satisfied `BL-024` dependency from `BL-040` so it shows as unblocked
- **Backlog: added BL-044** — new P1 item: `PendingRequest` records (approval-queue bookkeeping) have no TTL or delete path, so `GET /pending` and the `/agents.html` approval queue panel grow unbounded over time. Plans auto-expiry for resolved records (TTL, matching the existing pattern for approval/poll tokens) plus a manual `DELETE /pending/:id` and GUI clear control; the permanent audit trail is unaffected either way.
- **Backlog: added BL-043** — new P1 item: re-approving an already-approved pending request (`POST /pending/:id/approve`) mints a second, independently-valid approval token instead of no-oping or rejecting; each token is still correctly single-use (confirmed in `gateway/pending-store.ts`'s `validateApprovalToken`, no token replay), but the approval-generation side has no idempotency guard against repeated approval of the same pending id. Discovered live on the deployed proxy during BL-020 smoke-test follow-up (two "allow ... Pending request approved" audit entries for one pending id, traced to the same request having been approved twice via the GUI).
- **Backlog: added BL-042** — new P1 item to document the control-plane auth trust model explicitly and decide whether `GET /agents` and the vending-config-check-before-admin-auth-check ordering in `gateway/proxy-routes-agents-token.ts` need hardening. Filed from external code-review observations during BL-020's PR review; confirmed all three are pre-existing (not introduced by BL-020) and already partially documented, so kept out of that PR to avoid violating its "preserve existing behavior exactly" acceptance criterion.
- **Backlog: BL-034 closed out, concurrent-trust wording dropped** — removed the now-decided `BL-034` entry from `backlog.md`'s open P0 list per the file's own completed-item rule; dropped the satisfied `BL-034` dependency from `BL-020`, `BL-021`, `BL-022`, and `BL-030`; replaced "concurrent trust" acceptance wording on `BL-021`/`BL-022` with the single-active-provider decision from the new design spec
- **Backlog: BL-019 marked done** — removed the completed `BL-019` (JwtValidator extraction, shipped in PR #158) entry from `backlog.md`'s open P0 list per the file's own completed-item rule; dropped the now-satisfied `BL-019`/`BL-015` dependency references from `BL-020`, `BL-034`, and `BL-041` so `BL-034` (multi-issuer IdP trust model decision) shows as unblocked
- **Backlog planning intake (BL-024/BL-040/BL-041 + BL-021 sequencing note)** — rewrote BL-024 from docker-compose packaging to a k3d-based ephemeral CI workflow skeleton; added BL-040 to extend that workflow into a per-IdP matrix harness (Auth0/Keycloak/Entra as adapters land); added BL-041 for Keycloak `JwtValidator` + `IdpAdapter` implementation sequenced between Auth0 and Entra work; updated BL-021 source with explicit sequencing rationale (after BL-041 for lessons learned, not a hard dependency)
- **BL-024 acceptance criteria alignment** — updated backlog acceptance text to reflect shipped behavior in the ephemeral workflow (real Auth0 test secrets with per-run ephemeral operator client/grant creation and teardown cleanup), removing stale demo/guest-token-only wording
- **Ephemeral Auth0 smoke path alignment** — updated the k3d workflow smoke checks to exercise the real operator flow (`POST /agents` create, `POST /agents/:clientId/token` vend, `DELETE /agents/:clientId` cleanup) instead of relying on pre-provisioned read/admin test apps; guard deployment now receives Auth0 management env via Kubernetes secret for this isolated ephemeral lane
- **Ephemeral JWT naming alignment** — updated the k3d workflow, smoke script, and setup docs to use `MCP_JWT_ISSUER`, `MCP_JWT_AUDIENCE`, and `MCP_JWT_JWKS_URL` naming consistently with `scripts/dev.env`, removing issuer/audience alias ambiguity in CI setup
- **Ephemeral Helm invocation cleanup** — removed redundant `-f deploy/ephemeral/values-ci.yaml` from `k3d-ephemeral-auth0` because those values matched chart defaults byte-for-byte; deploy behavior is unchanged

### Fixed

- **Ephemeral workflow startup reliability** — UI container build now compiles `@mcp-tool-guard/gateway` before `@mcp-tool-guard/ui` so workspace type imports resolve during Docker build; `k3d-ephemeral-auth0` now installs `kubectl`/`helm` without Azure setup actions, fails fast with explicit missing-secret errors, and guards cleanup when `k3d` is unavailable so secondary errors do not mask primary failures
- **Ephemeral workflow trigger usability** — removed label-only gating from `.github/workflows/k3d-ephemeral-auth0.yml`; the job now runs on pull request `opened`/`synchronize`/`reopened` events and `workflow_dispatch`, eliminating manual label re-add cycles
- **Ephemeral kv-rest rollout stability** — kv-rest adapter now retries Redis connection on startup instead of crash-looping when Redis is still booting, `/health` reports Redis readiness, and the k3d rollout step now emits deployment/pod/log diagnostics when rollout fails to speed root-cause analysis
- **Ephemeral kv-rest probe auth fix** — `/health` now bypasses bearer auth in the kv-rest adapter so Kubernetes readiness/liveness probes no longer receive `401` and force restart loops
- **Ephemeral smoke auth parity option** — k3d smoke flow now supports `AUTH0_OPERATOR_BEARER_TOKEN` (admin user token) to emulate GUI control-plane behavior; M2M client-credentials remains supported as fallback when bearer token is not provided
- **Ephemeral operator client lifecycle automation** — k3d workflow now creates an Auth0 M2M operator client and `client-grant` at run start (scope `gateway:admin` on `AUTH0_AUDIENCE`) and deletes both during cleanup, removing reliance on long-lived operator client secrets
- **Ephemeral smoke agent-create compatibility** — smoke now defaults test-agent scope to `flights:read` (a typical declared API permission) instead of `demo:noop`, and surfaces the server error returned by `POST /agents` when creation fails
- **Ephemeral control-plane token compatibility** — k3d Helm values now set `MCP_M2M_REVOCATION=false` for the isolated CI lane so temporary operator M2M admin tokens are not rejected as "Agent revoked or deleted" before `/agents` create/vend/delete checks
- **Ephemeral kv-rest probe resilience** — kv-rest now starts its HTTP server immediately, retries Redis connection in the background, exposes `/live` for liveness, and keeps `/health` as Redis-readiness so startup races do not trigger rollout timeouts from early connection-refused probe failures
- **Ephemeral workflow scope reduction** — `.github/workflows/k3d-ephemeral-auth0.yml` pull-request trigger now uses `paths` filters so this heavier lane runs only when files used by the ephemeral stack (workflow, deploy/ephemeral, gateway, ui, smoke script, lockfiles) change
- Corrected stale BL-015 route ownership references in `docs/ARCHITECTURE.md` to point at extracted gateway route modules.

### Removed

- Removed redundant `deploy/ephemeral/values-ci.yaml` no-op override file and its documentation reference in `docs/ephemeral-k3d-ci.md`

## [0.5.0] - 2026-07-15

### Added

- **Grafana dashboard-as-code baseline** — added canonical dashboard storage under `dashboards/grafana/` with `mcp-tool-guard-proxy.dashboard.json` and workflow notes in `dashboards/grafana/README.md` so dashboard query/threshold changes are reviewable in PRs
- **Server registry hardening** — `POST`/`DELETE /servers` now write an audit entry (`__registry:add__` / `__registry:remove__`) with the acting bearer subject, so runtime MCP registration changes are traceable in `/audit`; `POST /servers` reports `persisted: false` and refuses to silently accept a registration when KV is disabled (rolls back the in-memory add on a KV write failure instead of leaving a non-durable entry); `/agents.html` "Remove" button now asks for confirmation before deregistering a server
- Team deck: added `docs/MCPToolGuard-Team-Overview.pptx` for internal project walkthroughs
- Demo deck refresh: updated `docs/overview.pptx` for the latest product walkthrough
- **OpenTelemetry (guard proxy)** — optional OTLP HTTP export via `gateway/telemetry.ts`; manual spans for proxy `tools/call` decisions (allow/deny/pending), `POST /audit/agent`, MCP upstream forward, Gemini LLM; gated on `OTEL_EXPORTER_OTLP_ENDPOINT`; [otel.md](docs/otel.md)

### Changed

- **Repo cleanup (test artifacts)** — removed temporary smoke/test markdown files used during manual validation runs (`*-smoke-*.md`, `test-pk*.md`) to keep the repository root clean
- **BL-015 final slice B (LLM route extraction)** — moved `/llm/complete` handling into `gateway/proxy-routes-llm.ts`; `gateway/proxy-server.ts` now delegates LLM completion routing via `handleLlmCompleteRoute` while preserving existing behavior (`GEMINI_API_KEY` gating, result/error logging, response codes, and HTTP request span wrapping)
- **Grafana dashboard JSON refresh** — checked in latest `dashboards/grafana/mcp-tool-guard-proxy.dashboard.json` from Grafana UI edits (including dashboard metadata and current panel/query state) so observability changes remain versioned and reviewable in PRs
- **OTel ops playbook (Grafana debug row)** — `docs/otel.md` now documents the collapsed telemetry-health debug row (`Error Span Rate`, `Total Span Ingest Rate`, `Span Rate by Name`), a fast no-data decision flow, and latency query caveats (`span.latency_ms` in `ms`, prefer wider ranges for bursty traffic)
- **BL-015 final slice A (MCP route extraction)** — moved `/mcp` and `/:serverId/mcp` enforcement/forwarding path into `gateway/proxy-routes-mcp.ts`; `gateway/proxy-server.ts` now delegates MCP handling via `handleMcpRoute` with behavior preserved (approval queue, token-bypass flow, audit/telemetry, and upstream forwarding contracts unchanged)
- **Backlog intake (BL-039)** — added decision-tracking item for approval-queue bypass semantics against independently guarded upstreams (proxy-layer approval token bypass does not elevate forwarded bearer for upstreams without `upstream_token_env`, e.g. `flight`), including explicit accept-vs-fix decision prompt
- **Local revocation ergonomics** — M2M immediate revocation now auto-enables only when KV is enabled; local no-KV runs default to revocation off to avoid false "Agent revoked or deleted" denials during `/agents.html` demo flow, with explicit override via `MCP_M2M_REVOCATION=true|false`
- **M2M revocation detection hardening** — guard-side deleted-agent enforcement now treats Auth0 M2M tokens as client-id shaped (`sub={clientId}@clients` or `client_id`) even when `gty` is absent, with `gty` retained only as secondary hint; this prevents silent bypass when tenant tokens omit grant-type claim, and the active-agent lookup is now injected server-side so browser bundles do not pull Node-only dependencies
- **Backlog tracking (BL-037/BL-038)** — added P1 follow-ups for Claude Code MCP harness integration guidance (guarded `/ :serverId /mcp` usage, token vending/refresh via headers helper, dual approval expectations) and for multi-agent delegation trust-model hardening (scope attenuation/delegation, parent-child trace correlation, cross-agent injection boundary, and risk-tiered approvals)
- **Agents UI chat-state guardrail** — `ui/src/agents-main.ts` now disables Send unless an agent is selected and initialized, clears Send state when selected agent/runtime is revoked or reset, and shows explicit status guidance instead of silent no-op when sending without an active initialized agent
- **Backlog tracking (BL-036)** — added P1 follow-up for env-gated Auth0 happy-path integration coverage on `POST /agents`, `POST /agents/:clientId/token`, and `POST /token`, with skip-when-no-secrets behavior and cleanup requirements
- **BL-015 slice (agents/token routes + tests)** — extracted `/agents*` and `/token` route handling into `gateway/proxy-routes-agents-token.ts`; delegated agent/token endpoints from `gateway/proxy-server.ts`; expanded gateway tests for `/agents` list + admin auth guards and token-vending-not-configured contracts
- **BL-015 cleanup (dead imports)** — removed stale `/servers` extraction leftovers from `gateway/proxy-server.ts` import block after route logic moved into `gateway/proxy-routes-servers.ts`
- **BL-015 slice (servers routes + tests)** — extracted `/servers` route handling into `gateway/proxy-routes-servers.ts`; delegated server list/add/remove/tools endpoints from `gateway/proxy-server.ts`; expanded gateway tests to cover `/servers` list/auth/add/remove and `/servers/:id/tools` error contracts
- **Backlog tracking (BL-035)** — added P1 item to isolate or explicitly document Render PR preview shared state versus production (KV/Auth0/upstream token scope) after preview validation showed production-shared behavior
- **BL-015 slice (helpers + routes + tests)** — extracted shared proxy HTTP helpers into `gateway/http-helpers.ts`; moved `/audit` and `/pending` route handling into `gateway/proxy-routes-audit.ts` and `gateway/proxy-routes-pending.ts`; reduced `gateway/proxy-server.ts` monolith by delegating to new route modules; expanded gateway baseline tests for `/health`, `/audit`, MCP deny contracts, and pending admin/poll-token flows
- **Backlog tracking (BL-015)** — added explicit execution strategy note to deliver route decomposition in small slices (helpers-first, then one route group at a time) with tests and GUI smoke validation after each slice
- **Backlog tracking (BL-018)** — marked BL-018 as in-progress and clarified this PR delivers the preflight/CORS portion while browser-context deny -> pending -> approve -> retry coverage remains
- **Gateway regression coverage** — added preflight CORS test for `OPTIONS /pending/:id` to assert `X-Pending-Token` remains allowed in `Access-Control-Allow-Headers`, protecting approval polling behavior during route refactors
- **Backlog cleanup follow-up** — aligned BL-022 acceptance with BL-034 trust-model decision and restored BL-030 dependency chain to include BL-020/BL-021 implementation prerequisites
- **Backlog cleanup (post-review)** — trimmed BL-003 acceptance to remaining idempotent-create work, removed BL-005 per-user attribution requirement (moved to BL-030 scope), added BL-034 IdP trust-model decision gate, and aligned BL-020/BL-021/BL-030 dependencies with implementation order
- **Docs cleanup** — removed redundant local README variants (`readme-local.md`, `readme-peter.md`, `readme-peter99.md`, `readme-pk.md`) to keep the root docs surface canonical
- **Backlog: post-0.4.0 next-phase intake** — merged Track 0/1/2/3/4 stories into canonical `backlog.md`; promoted BL-015 decomposition to P0 prerequisite; added dependency links and blocked status on dev-meeting-gated local-dev stories
- **Docs: auth/approval flow consistency pass** — updated summary docs (`demo-proxy`, `cursor-guide`, `kv-design`, `ARCHITECTURE`, `NEXT-STEPS`) to consistently document `pending_poll_token`/`X-Pending-Token` for pending polling, `X-Approval-Token` for approved retry, and bearer requirements on `POST /audit/agent`
- **Backlog: browser CORS regression coverage (BL-018)** — added P1 backlog item to automate browser-context approval polling regression checks (`X-Pending-Token` preflight/CORS + deny->pending->approve->retry path)
- **Docs: approval queue polling auth update** — corrected manual Demo 7 curl flow in `docs/demo-proxy.md` to use `pending_poll_token` via `X-Pending-Token` for `GET /pending/:id`; aligned `docs/cursor-guide.md` wording with hardened pending endpoint behavior (`X-Pending-Token` or `gateway:admin` fallback when enabled)
- **Backlog: BL-017 acceptance clarity** — clarified that admin/control-plane events (`__registry:add__`, `__registry:remove__`, agent lifecycle) belong in a dedicated admin/compliance view, while the default "Server enforcement" panel stays focused on runtime tool-call decisions
- **Backlog: admin/compliance events page (BL-017)** — added P2 backlog item to surface session-less admin actions (registry mutations, agent create/revoke) in a dedicated view, discovered while validating the server-registry audit hardening
- **Backlog: tamper-evident audit receipts (BL-016)** — added P2 backlog item for signed/hashed execution receipts; enterprise roadmap item for audit integrity proof

- **Docs: client-readiness accuracy pass** — `MCP_APPROVAL_QUEUE=true` callout added to CONCEPT.md (limitations table) and README.md (quick start); `POST /llm/complete` route added to guard-proxy.md; ARCHITECTURE.md gains rate limiter, `POST /audit/agent`, `POST /llm/complete`, and `POST /token` in component map; demo-proxy.md Demo 8 gains prod runtime-registration callout for Slack.

### Changed

- **Workflow hardening (changelog policy)** — enforce changelog updates on every non-Dependabot commit in PR CI, add local pre-commit hook install path (`make install-hooks`) and CONTRIBUTING guidance so changelog compliance is proactive instead of last-minute.
- **Demo deck follow-up (PR #115)** — refined `docs/overview.pptx` content/flow for the current proxy enforcement walkthrough.
- **Changelog compliance (docs/post-otel-doc-cleanup)** — add required `Unreleased` entry to satisfy PR changelog check for non-Dependabot contributions.
- **Docs accuracy pass (0.4 follow-up)** — fix `GET /audit` response shape (`sources` array, not `.source` / `guard-proxy`); ARCHITECTURE agent route `:clientId`, `agents-main.ts` line ~441; render-deploy GitHub live vs runtime Slack; CONCEPT authoritative audit on proxy; demo-proxy Demo 5 + gateway-agent anchor
- **Docs: ARCHITECTURE.md comprehensive refresh** — Added GatewayAgent flow (`agents-main.ts` → `proxy-api.ts` → `token-vendor.ts` → `gateway-agent.ts`); expanded component map with agent provisioning; updated system context diagram to show both FlightAgent and GatewayAgent paths; clarified "Today vs next" table with separate rows for FlightAgent (demo) vs GatewayAgent (M2M) with approval queue support
- **Docs cleanup + backlog canonicalization** — removed stray raw notes from `docs/demo-proxy.md`; updated `docs/otel.md` to shipped status with acceptance checklist complete; added `GEMINI_API_KEY` and distributed rate-limit notes in `docs/guard-proxy.md`; refreshed `docs/ARCHITECTURE.md` shipped-state rows; added root `backlog.md` as canonical open-work tracker and cross-linked from README/ROADMAP/NEXT-STEPS

### Fixed

- **Approval polling CORS fix** — added `X-Pending-Token` to proxy CORS `Access-Control-Allow-Headers` so browser approval polling from `/agents.html` can call `GET /pending/:id` without preflight failure
- **BL-001 / BL-002 hardening** — `POST /audit/agent` now requires Bearer with `audit:write` or `gateway:admin` unless explicit trusted demo mode (`MCP_AUDIT_AGENT_TRUSTED_MODE=true`); `GET /pending/:id` now requires a short-lived `pending_poll_token` (or `gateway:admin` when control-plane auth is enabled), with `pending_poll_token` returned in the `202` pending response; approval-poll clients updated accordingly
- **Gateway PR CI coverage** — added gateway auth integration tests (`gateway/tests/proxy-auth.test.mjs`) and wired them into PR CI (`.github/workflows/ci.yml`) so hardening regressions fail in CI
- **OpenTelemetry 0.220 compatibility** — updated `gateway/telemetry.ts` to use the new `BatchLogRecordProcessor({ exporter })` constructor signature required by `@opentelemetry/sdk-logs` 0.220.0
- **Changelog policy (CI workflow)** — Fix YAML syntax error in `changelog.yml`: heredoc `<<EOF` with unindented `$(...)` content broke the YAML block scalar parser; replaced with `<<<` here-string fed from a variable
- **OpenTelemetry 0.219.0 API migration** — Updated `gateway/telemetry.ts` for OTel SDK breaking changes: `new Resource()` → `resourceFromAttributes()` (resources v2.8.0), LoggerProvider `addLogRecordProcessor()` → inline `processors` array (sdk-logs 0.219.0)
- **Changelog policy (CI workflow)** — Exempt Copilot from per-commit CHANGELOG requirement to allow IDE-assisted fixes on Dependabot PRs without blocking
- **Starlette CVE-2026-54282** — Regenerated `servers/flight/uv.lock` to pin Starlette ≥1.3.1 (unvalidated request path handling in authority)
- **ARCHITECTURE.md endpoint reference** — Corrected `POST /agents` endpoint location: `gateway/proxy-api.ts` (non-existent) → `gateway/proxy-server.ts` (actual location)

### Removed

- Removed stray placeholder file `new-test.md`
- Duplicate Flight manifest cleanup — removed stale `servers/flight/servers/flight/requirements.txt` (accidental nested export path)

## [0.4.0] - 2026-06-22

### Added

- **Runtime vendor MCP registration** — `POST /servers` accepts optional `upstream_token_env` field; proxy resolves token from env at registration time; KV persistence carries `upstream_token_env` across restarts; GUI "External MCPs" form gains optional upstream token env var field; `proxy-api.ts` `addServer` updated to forward the field
- **Proxy stream header fix** — `gateway/mcp-upstream.ts` strips `content-length` and `content-encoding` from upstream streaming responses to prevent downstream parse errors (e.g. Vite dev proxy `ERR_STREAM_WRITE_AFTER_END`)
- **Docs accuracy pass** — remove stale Slack stub references; `config.yaml`/`config.prod.yaml` Slack blocks removed (runtime-registered instead); deploy/arch docs updated to reflect runtime vendor MCP model; `NEXT-STEPS.md` adds GUI-managed upstream secrets as future item

- **Tier-2 hardening** — `gateway/llm-proxy.ts`: `POST /llm/complete` proxies Gemini server-side (`GEMINI_API_KEY` on Render, never in browser bundle); `GeminiRunner` calls proxy instead of Google directly; `gemini_configured` on `/health`; KV audit persistence (`gateway:audit:recent`, ring buffer 500, loaded at startup); distributed rate limiting (`kvRateLimitExceeded` fixed-window KV counter per IP per minute, complements in-memory sliding window); `kvSet` gains optional `ttlSec`; `examples/python-agent/agent.py` stdlib-only backend agent with approval retry loop
- **Track 3 — Approval queue (end-to-end)** — `gateway/pending-store.ts`, `MCP_APPROVAL_QUEUE=true` gate, `202` pending response, admin `/pending/*` resolve routes, time-bound approval tokens bound to tool+server, `x-approval-token` bypass path, Gemini native function-calling, agent polls `/pending/:id` and retries with token; audit decision type includes `"pending"`
- **Track 3 prod proof** — [track3-approval-queue-proof.md](docs/track3-approval-queue-proof.md): `repo:read` agent → approval queue → admin approves → one-time token → retry → GitHub file created; Render logs + commit link
- **Track 2 prod proof** — [track2-github-proof.md](docs/track2-github-proof.md): GitHub MCP curl allow + **proxy write deny** (`repo:read`-only agent → `-32001` on `create_or_update_file`), Render logs, screenshots; [demo-proxy Demo 6](docs/demo-proxy.md#demo-6--github-mcp-external-upstream) updated
- **GitHub MCP (Track 2)** — `upstream_token_env` on server config; proxy substitutes `GITHUB_MCP_TOKEN` for upstream auth while enforcing caller JWT scopes (`repo:read` / `repo:write`); `upstream_auth_missing` on `/health`; [demo-proxy Demo 6](docs/demo-proxy.md#demo-6--github-mcp-external-upstream)
- **Gateway KV persistence (Track 1)** — `gateway/kv.ts` Upstash REST client; runtime MCP registry + agent records survive proxy restart; `GET /agents`; `kv_enabled` on `/health`; `/agents.html` loads agents from server (secrets in sessionStorage only)

### Changed

- **Post–Track 2 docs hygiene** — ROADMAP, ARCHITECTURE, deploy-overview, render-deploy, CONCEPT, identity, auth0-setup (`repo:read`/`repo:write`), cursor-guide, NEXT-STEPS limitations, README gateway-first pivot, vercel-deploy, `immediate-nest-step.md`
- **Docs + proxy hardening follow-up** — documented demo trust caveats for `POST /audit/agent` and `GET /pending/:id`; updated Demo 7 GitHub example to base64-encode file content; moved Gemini upstream auth from URL query to `x-goog-api-key` header and aligned env docs to server-side `GEMINI_API_KEY` usage.

### Fixed

- **Approval queue — pending poll auth** — `GET /pending/:id` no longer requires `gateway:admin`; agents can poll their own pending ID without an admin token; `localeCompare` crash on stale KV entries missing `requested_at` field guarded with `?? ""`
- **Approval queue — scope bypass** — `approvedViaToken` flag prevents final 403 after valid approval token; polling GETs (`/audit`, `/pending/*`) exempted from rate limiter; agent retry loop breaks on tool error instead of looping; dropdown `<select>` no longer reset mid-interaction by background poll
- **Gateway KV scan** — fix Upstash REST SCAN URL and string cursor `"0"` termination (was hanging Render startup when `KV_REST_API_*` set)
- **Agent re-vend** — encrypt M2M `clientSecret` at create (AES-GCM, key from `GATEWAY_AGENT_SECRET_KEY` or `AUTH0_MGMT_CLIENT_SECRET`); `POST /agents/:clientId/token` vends JWT so persisted agents are usable after refresh/new browser
- **Cursor implementation guide** — [cursor-guide.md](docs/cursor-guide.md): three sequential tracks (KV registry → GitHub MCP → approval queue); cross-links [kv-design](docs/kv-design.md) and [CONCEPT → unowned MCP](docs/CONCEPT.md#third-party--unowned-mcp); approval queue KV keys sketched in kv-design
- Docs: align [NEXT-STEPS](docs/NEXT-STEPS.md), [ROADMAP](docs/ROADMAP.md), [demo-proxy](docs/demo-proxy.md) with three-track build order; flight `/` as canonical audit demo surface
- **Agent gateway admin auth** — `gateway:admin` on control plane (`POST/DELETE /servers`, `/agents`, `POST /token`) when guard + IdP trust enabled; `/agents.html` operator sign-in; `GET /health` reports `control_plane_auth`
- Docs: product differentiators + build filter ([ROADMAP](docs/ROADMAP.md#build-filter)), proof vs presentation ([CONCEPT](docs/CONCEPT.md#proof-vs-presentation)), canonical demo guidance ([demo-proxy.md](docs/demo-proxy.md))
- Structured upstream errors — proxy returns `{ error: "upstream_unavailable", server, detail }` on MCP connect/discovery failures; `tools/call` JSON-RPC error when upstream is unreachable
- Flight guard middleware — 1 MiB max request body before JSON parse (DoS hardening)

- **Agent gateway (stage 1, in-memory)** — dynamic MCP registry (`GET/POST/DELETE /servers`), tool discovery (`GET /servers/:id/tools`), Auth0 M2M agent lifecycle (`POST/DELETE /agents`), token vending (`POST /token`), three-layer audit (`agent` / `proxy` / `mcp` sources, `POST /audit/agent`), sliding-window rate limit (60 req/min per IP)
- **`/agents` UI** — register external MCPs, create/revoke M2M agents, LLM selector (WebLLM, Gemini, Groq, Mistral), three-layer audit panel with trace correlation
- [.env.example](.env.example) — `AUTH0_*` mgmt + audience vars for agent gateway
- [docs/render-deploy.md](docs/render-deploy.md) — step-by-step Render deploy guide for guard proxy (env vars, build/start, smoke tests, UI rewire, `Accept` header for curl, troubleshooting)
- [docs/demo-proxy.md](docs/demo-proxy.md) — live demo script: Network tab, read-only deny, Render logs, curl proxy deny, code review path
- [docs/deploy-overview.md](docs/deploy-overview.md) — single deploy map: local proxy path, prod three-service layout (UI + Render proxy + flight)
- `gateway/config.prod.yaml` — prod policy config with Vercel flight URL; set `MCP_PROXY_CONFIG=config.prod.yaml` on Render
- `make dev` — one command starts flight → guard proxy → UI; `scripts/dev.env` for shared `MCP_JWT_*`; `make stop` frees :8000/:8787/:5173
- **Guard HTTP proxy** (#12) — `gateway/proxy-server.ts`: JWT scope enforcement on `tools/call`, forward to upstream MCP from `gateway/config.yaml`, `GET /audit` + `GET /health`; `make proxy` ([guard-proxy.md](docs/guard-proxy.md))
- Vite dev proxies `/mcp` and `/audit` to guard proxy (:8787) instead of flight directly
- Docs: scopes vs roles — IdP grants scope rights (optionally via roles); guard enforces per tool ([CONCEPT](docs/CONCEPT.md#scopes-roles-and-identity), [identity](docs/identity.md#scopes-vs-roles-how-admins-grant-access), [auth0-setup](docs/auth0-setup.md))
- **Agent trace** panel in audit sidebar — per-turn routing (heuristic / LLM / pending), model preview, `trace_id` highlight across server + client rows
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system diagrams (mermaid), three observability planes, policy, today vs guard proxy
- UI client guard loads policy from `gateway/config.yaml` (Vite yaml import); `npm run check:demo-policy` keeps demo flight `guard_config.yaml` aligned until guard proxy (#12)

### Fixed

- Guard proxy audit stdout — single-line `console.log` per allow/deny so Render and PaaS log viewers show `[MCPToolGuard]` request lines (multi-arg `console.info` was dropped by some hosts)
- Vite dev proxy `/agents` no longer intercepts `/agents.html` (including `?query` URLs); agent forms use `method="post"` to avoid GET navigation
- Agents page lazy-loads `gateway-agent` on Initialize so Add MCP / Create agent work without loading `mcp-client` at page load
- Vite proxy regex for `/:serverId/mcp` anchored with `$` so `/src/mcp-client.ts` is not forwarded to guard proxy
- `GatewayAgent` reuses the same LLM runner after Initialize (fixes WebLLM “not initialized” on Send)
- Agents page passes Auth0 JWKS trust (`jwtTrustFromAuth0`) so M2M tokens verify in the browser guard
- Guard proxy listens on `PORT` when `MCP_PROXY_PORT` is unset (Render injects `PORT`; local dev uses `MCP_PROXY_PORT` / `make dev`)

### Changed

- Root `package.json` — `engines.node` `>=22` (matches CI)
- Docs: Render deploy + demo-proxy cross-links in README, CONTRIBUTING, guard-proxy, NEXT-STEPS, deploy-overview, vercel-deploy, ARCHITECTURE, ROADMAP, CONCEPT
- Docs: prod architecture updated — guard proxy **deployed on Render**; next step is external MCP wiring
- Docs: **deploy-overview** — prod today is UI → Render proxy → Vercel flight (not UI → flight direct)
- Docs: defer **#9/#10** multi-server mock MCP; **#12** guard proxy is primary product path ([NEXT-STEPS](docs/NEXT-STEPS.md#implementation-backlog-post-030))
- Docs: agent gateway prod env — `AUTH0_MGMT_*` on Render, `VITE_PROXY_BASE_URL` on Vercel; routes in [guard-proxy.md](docs/guard-proxy.md); smoke tests in [render-deploy.md](docs/render-deploy.md), [vercel-deploy.md](docs/vercel-deploy.md)
- Docs: agent gateway admin auth sketch — `gateway:admin` control plane vs M2M runtime tokens ([NEXT-STEPS](docs/NEXT-STEPS.md#agent-gateway-admin-auth-sketch), [identity.md](docs/identity.md#admin-vs-agent-tokens-agent-gateway))
- Docs: agent registry + Auth0 sync backlog — KV source of truth, unique `mcp-agent-*` names, reuse/templates, `GET /agents` ([NEXT-STEPS](docs/NEXT-STEPS.md#agent-registry-auth0-sync-sketch), [kv-design.md](docs/kv-design.md#guard-proxy-kv-agent-gateway))
- Release process: CHANGELOG + optional git tag only — no GitHub Releases UI ([RELEASE.md](docs/RELEASE.md), [CONTRIBUTING.md](CONTRIBUTING.md))
- Workflow: always branch + PR to `main` — no direct pushes ([CONTRIBUTING.md](CONTRIBUTING.md), `.cursor/rules/release-and-pr-workflow.mdc`)
- ROADMAP #8 done: canonical policy in `gateway/config.yaml`; `servers/flight/guard_config.yaml` documented as demo-only embedded guard ([CONCEPT.md](docs/CONCEPT.md))

### Removed

- [docs/railway-deploy.md](docs/railway-deploy.md) and `railway.toml` — replaced by Render deploy guide (proxy live on Render free tier)

## [0.3.1] - 2026-06-02

### Added

- WebLLM heuristics: `FL 505` → `FL505`, `search all flights` / bare `search`, intercept invented booking JSON ([ROADMAP #11](docs/ROADMAP.md))
- Read-only Auth0 demo screenshots: jwt.io `flights:read` token and prod UI scope deny ([docs/images/demo/](docs/images/demo/README.md))

### Changed

- Stronger agent system prompt — never emit raw flight/booking JSON; only tool JSON or plain text
- Planning docs: mark ROADMAP #11 done; suggest #8 policy drift next (`immediate-nest-step`, `NEXT-STEPS`, `ROADMAP`)

## [0.3.0] - 2026-06-02

### Added

- Auth0 SPA login in demo UI (`@auth0/auth0-spa-js`) with **guest demo** fallback (`demo-tokens.json` dropdown)
- Dual JWT trust on flight server and SDK: **JWKS + `iss`/`aud`** (Auth0) or **demo PEM** (guest)
- `GET /audit` requires valid `Authorization: Bearer` when guard is enabled
- UI audit panel: visible error when server audit fetch fails (401, network, etc.)
- Flight health: `jwt_trust_enabled`, `kv_enabled` (when `KV_REST_API_*` set)
- Vercel KV (Upstash REST) for durable **server audit** and **bookings** on serverless; in-memory fallback locally ([kv-design.md](docs/kv-design.md))
- README Live demo screenshots (prod UI + Auth0 access token on jwt.io)
- [docs/kv-design.md](docs/kv-design.md), [docs/images/demo/](docs/images/demo/README.md)

### Fixed

- Auth0 RBAC: read `permissions` claim in flight guard and SDK `ToolGuard` (alongside `scope` / `scp`)

### Changed

- `ToolGuard` accepts optional `jwtIssuer`, `jwtAudience`, `jwksUrl` for IdP tokens
- Env vars: `VITE_AUTH0_*`, `MCP_JWT_*`, `VITE_ENABLE_GUEST_DEMO`, `KV_REST_API_*` — see [auth0-env.example](docs/auth0-env.example), [vercel-deploy.md](docs/vercel-deploy.md#vercel-kv-phase-b)
- Docs: [auth0-setup.md](docs/auth0-setup.md) (local testing learnings), [identity.md](docs/identity.md), [NEXT-STEPS](docs/NEXT-STEPS.md), [vercel-deploy.md](docs/vercel-deploy.md), [README](README.md)
- Project rule: git-only workflow (no `gh` CLI); [CONTRIBUTING.md](CONTRIBUTING.md) updated

### Security

- Loud startup warning when `MCP_GUARD_ENABLED=false` (enforcement bypassed)

---

## [0.2.0] - 2026-05-25

### Added

- [docs/vercel-deploy.md](docs/vercel-deploy.md) — Vercel deploy guide (verified settings, troubleshooting, live demo URLs)
- [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md) — post–0.2.0 priorities and 0.3.0 backlog
- Live demo: [UI](https://mcp-tool-guard-ui.vercel.app/), [flight health](https://mcp-tool-guard-flight-server.vercel.app/health)
- Server-side JWT scope enforcement on flight MCP (`guard.py`, `guard_middleware.py`, `guard_config.yaml`)
- `Authorization: Bearer` on MCP HTTP client; `VITE_MCP_URL` for remote flight deploy
- Flight `GET /audit` for recent server-side allow/deny entries (in-memory)
- Audit UI: **Server enforcement** (authoritative) + **Agent attempts** (SDK observability); `/audit` Vite proxy for local dev
- `session_id` and `trace_id` on audit entries — correlate agent attempts with server enforcement
- `make stop` to gracefully stop the flight server on port 8000

### Changed

- CORS on flight server: default allow UI + local Vite origins; override via `MCP_CORS_ORIGINS` (see [vercel-deploy.md](docs/vercel-deploy.md))
- CONCEPT: observability scope (metrics/traces/logs framing vs tool-gate focus; in/out of scope for 0.x)
- Docs: README live demo + [vercel-deploy.md](docs/vercel-deploy.md); ROADMAP 0.2.0 complete, [0.3.0 hardening](docs/ROADMAP.md#release-030--hardening--multi-server)
- Bump `typescript` from 5.9.x to 6.0.3 in `ui` and `gateway` (with Vite 8 on `ui`)
- Document demo vs production shape in ROADMAP and CONCEPT (dual audit UI; Grafana/Loki for prod server logs)
- Dual audit framing in UI/docs: server = security decisions, agent attempts = intent (not compliance evidence)
- CI workflow (`ci.yml`): typecheck, npm build, and flight server import check on PRs to `main`
- Changelog workflow: exempt Dependabot PRs from required `CHANGELOG.md` diff
- Documentation: [ROADMAP.md](docs/ROADMAP.md), [RELEASE.md](docs/RELEASE.md), [CONTRIBUTING.md](CONTRIBUTING.md)
- PR template and CI check requiring CHANGELOG updates on pull requests to `main`
- Cursor rule for branch + PR + changelog workflow
- Condensed [CONCEPT.md](docs/CONCEPT.md) with current limitations and remote deployment notes
- Root / workspace package version → `0.2.0`

### Fixed

- Flight `vercel.json`: remove `functions` block (caused instant “unmatched function pattern” before Python build)
- CI typecheck: build `gateway` before `ui` typecheck (`dist/` is gitignored; types live in `gateway/dist`)
- CI flight job: commit `ui/public/demo-public.pem` (was ignored by `*.pem`; required for server import)
- ASGI middleware SSE fix: forward `receive()` after body replay (fixes Initialize failures)
- Agent pending-state loop when LLM picked wrong tool; help text and book-by-route heuristics

---

## [0.1.0] - 2025-05-25

### Added

- Flight MCP server (FastMCP, mock data, HTTP `/mcp`, Vercel entrypoint)
- Browser UI with WebLLM agent loop and audit dashboard
- TypeScript `ToolGuard` (JWT verify, per-tool scopes from `gateway/config.yaml`)
- Demo RSA keys and JWT profiles (`read_only`, `booking`, `admin`)
- Makefile: `setup`, `flight`, `ui`, `keys`
- Docs: README quick start, CONCEPT (JWT reference)

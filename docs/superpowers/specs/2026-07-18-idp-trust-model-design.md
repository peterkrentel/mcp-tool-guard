# BL-034: Single-Active-IdP Trust Model

## Status

Design decision only — no code changes in this doc. BL-020, BL-021, and BL-041 implement against this decision.

## Context

`gateway/guard.ts`'s `DefaultJwtValidator` currently supports exactly one JWKS-based issuer (Auth0, via `MCP_JWT_ISSUER`/`MCP_JWT_AUDIENCE`/`MCP_JWT_JWKS_URL`) plus one static PEM fallback (`MCP_GUARD_PUBLIC_KEY_PEM`, used only for the flight demo's pre-signed guest tokens). BL-019 already extracted a `JwtValidator` interface so `ToolGuard` consumes validation via injection rather than implementing it internally, explicitly anticipating future per-IdP implementations (Keycloak, Entra).

`backlog.md`'s original BL-034 acceptance text asked for "concurrent issuer validation (Auth0 M2M and Entra user identity)" — i.e. one gateway deployment trusting two real IdPs at once. That framing is rejected below.

## Decision

**One active IdP provider per deployment. Never concurrent.**

Every enterprise deployment of MCPToolGuard already has exactly one identity provider in its infrastructure (Auth0, Keycloak, or Entra) — not two. A single gateway instance is configured for that one provider at deploy time. This is a deliberate simplification of the original backlog wording, decided after confirming that concurrent-IdP deployments don't reflect real enterprise usage.

### Provider selection

An explicit env var selects the active provider:

```
MCP_IDP_PROVIDER=auth0   # auth0 | keycloak | entra
```

Explicit rather than inferred, because the two existing env-var families already tell inconsistent stories:

- `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_MGMT_CLIENT_ID`/`_SECRET` are already Auth0-specific by name (Management-API side: creating/revoking M2M agents).
- `MCP_JWT_ISSUER`/`MCP_JWT_AUDIENCE`/`MCP_JWT_JWKS_URL` are deliberately provider-agnostic (JWKS verification is the same OIDC mechanism regardless of issuer). These cannot be used to infer which provider is active.

One selector drives **both** which `JwtValidator` implementation and which `IdpAdapter` implementation get constructed, so it's impossible to end up with (say) an Auth0 validator paired with Keycloak admin credentials.

**Backward compatibility:** if `MCP_IDP_PROVIDER` is unset but `MCP_JWT_*` vars are present, default to `auth0` (today's only real option) so existing deployments don't break. Log a one-time startup notice recommending the var be set explicitly going forward. If neither is set, only the PEM demo path is active — same as today.

**Fail-closed startup validation:** an unrecognized `MCP_IDP_PROVIDER` value, or a value set without its corresponding required config present, fails startup with a clear error rather than silently falling back — consistent with the project's existing fail-closed posture.

### What doesn't change

- `JwtValidator` interface (BL-019) is untouched. Each provider's implementation (`DefaultJwtValidator`/Auth0 today, `KeycloakJwtValidator` per BL-041, an Entra validator per BL-021) owns its own `extractScopes()` claims-mapping internally — Auth0's flat `scope`/`permissions`, Keycloak's nested `realm_access.roles`/`resource_access`, Entra's `roles`/`scp`.
- `ToolGuard` is untouched — it already accepts exactly one injected `JwtValidator`, which is the correct shape for "one active provider."
- The PEM-based guest-token fallback is not a real IdP and is not part of this decision. It remains a local/demo-only mechanism (per the existing `CLAUDE.md` demo-secrets note) and keeps working independently of whichever `MCP_IDP_PROVIDER` is configured.

### `/health` reporting

Replace today's boolean `jwt_trust_enabled: true/false` with `idp_provider: "auth0" | "keycloak" | "entra" | null`, satisfying BL-020's acceptance note that `/health` identity reporting should align with this decision.

## Downstream impact (for implementers)

- **BL-020** (IdP adapter interface + Auth0 impl): construct the single active adapter/validator pair based on `MCP_IDP_PROVIDER`; update acceptance wording from "concurrent trust" to "single active provider."
- **BL-021** (Entra): same — drop "concurrent trust" framing.
- **BL-041** (Keycloak): same — drop "concurrent trust" framing; this is where `KeycloakJwtValidator`/`KeycloakIdpAdapter` are validated as the second real provider before Entra.
- **BL-030** (per-user audit attribution): drop "concurrent trust" framing from its dependency note; attribution logic doesn't change based on this decision.
- **`backlog.md`**: BL-034/BL-020/BL-021/BL-030 acceptance/source text updated to remove "concurrent issuer"/"concurrent trust" language once this spec is approved.

## Explicitly out of scope

- Actual `MCP_IDP_PROVIDER`-driven construction code in `proxy-server.ts` — that's BL-020/BL-021/BL-041.
- Per-server/per-tool issuer restriction in `config.yaml` — rejected during brainstorming; any trusted (single) provider's tokens are equally valid anywhere scopes match, no new `config.yaml` field needed.
- Multi-IdP-per-deployment support of any kind.

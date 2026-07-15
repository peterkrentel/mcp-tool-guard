# Ephemeral k3d CI (UI + Guard + Redis)

This path is additive and isolated from the existing localhost (`make dev`) and hosted (`Vercel`/`Render`) flows.

## Goal

Run a fully self-contained ephemeral environment in GitHub Actions:

- UI in Kubernetes
- Guard proxy in Kubernetes
- Self-hosted Redis in Kubernetes
- In-cluster REST bridge compatible with current `KV_REST_API_URL` / `KV_REST_API_TOKEN` usage
- Auth0-backed smoke checks

No existing application runtime code path is changed.

## Files

- Workflow: `.github/workflows/k3d-ephemeral-auth0.yml`
- Helm chart: `deploy/ephemeral/helm/guard-ephemeral`
- CI values: `deploy/ephemeral/values-ci.yaml`
- KV REST adapter: `deploy/ephemeral/kv-rest-adapter`
- Smoke test: `scripts/smoke-auth0-k3d.sh`
- Dockerfiles:
  - `gateway/Dockerfile`
  - `ui/Dockerfile`

## Trigger model

The workflow is intentionally separate from fast CI and only runs on:

- `workflow_dispatch`
- PR label `run-k3d-ephemeral`

## Required GitHub secrets

- `AUTH0_ISSUER`
- `AUTH0_AUDIENCE`
- `AUTH0_JWKS_URL` (optional if derivable from issuer, but recommended to set explicitly)
- `AUTH0_READ_CLIENT_ID`
- `AUTH0_READ_CLIENT_SECRET`
- `AUTH0_ADMIN_CLIENT_ID`
- `AUTH0_ADMIN_CLIENT_SECRET`
- `MCP_GUARD_PUBLIC_KEY_PEM`

## What the smoke test verifies

- Guard `/health` reports `kv_enabled: true`
- UI is reachable via ingress host
- Read token is blocked from control-plane mutation
- Admin token can add and delete a server
- Guard `/audit` is readable with valid bearer

## Notes

- This path is ephemeral CI validation only.
- Existing `ci.yml` remains unchanged for fast typecheck/test feedback.
- Existing localhost and hosted deployment docs remain the source of truth for current runtime paths.

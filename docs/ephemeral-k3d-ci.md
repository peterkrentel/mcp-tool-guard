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

The workflow is intentionally separate from fast CI and runs on:

- `workflow_dispatch`
- pull request updates (`opened`, `synchronize`, `reopened`)

## Required GitHub secrets

- `MCP_JWT_ISSUER`
- `MCP_JWT_AUDIENCE`
- `MCP_JWT_JWKS_URL`
- `AUTH0_DOMAIN`
- `AUTH0_MGMT_CLIENT_ID`
- `AUTH0_MGMT_CLIENT_SECRET`
- `AUTH0_OPERATOR_CLIENT_ID`
- `AUTH0_OPERATOR_CLIENT_SECRET`
- `MCP_GUARD_PUBLIC_KEY_PEM`

## What the smoke test verifies

- Guard `/health` reports `kv_enabled: true`
- UI is reachable via ingress host
- Operator token can create and delete an Auth0-backed agent via `/agents`
- Operator token can vend an agent access token via `/agents/:clientId/token`
- Guard `/audit` is readable with valid bearer

## Reusing the smoke test outside workflow

The same script can be used against localhost or hosted environments by changing env vars:

```bash
GUARD_BASE_URL=http://localhost:8787 \
UI_BASE_URL=http://localhost:5173 \
MCP_JWT_ISSUER=https://<tenant>/ \
MCP_JWT_AUDIENCE=https://mcp-tool-guard \
AUTH0_OPERATOR_CLIENT_ID=<operator-client-id> \
AUTH0_OPERATOR_CLIENT_SECRET=<operator-client-secret> \
AGENT_SCOPE=demo:noop \
AGENT_SERVER_ID=demo \
./scripts/smoke-auth0-k3d.sh
```

Notes:

- `UI_BASE_URL` is optional (UI check is skipped if unset).
- Script auto-cleans the created agent with `trap` on exit.
- For hosted runs, use a CI/test Auth0 tenant or constrained operator app to keep blast radius low.

## Notes

- This path is ephemeral CI validation only.
- Existing `ci.yml` remains unchanged for fast typecheck/test feedback.
- Existing localhost and hosted deployment docs remain the source of truth for current runtime paths.

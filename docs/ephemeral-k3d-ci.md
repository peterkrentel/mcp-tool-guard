# Ephemeral k3d CI (UI + Guard + Redis)

This path is additive and isolated from the existing localhost (`make dev`) and hosted (`Vercel`/`Render`) flows.

## Goal

Run a fully self-contained ephemeral environment in GitHub Actions:

- UI in Kubernetes
- Guard proxy in Kubernetes
- Self-hosted Redis in Kubernetes
- In-cluster REST bridge compatible with current `KV_REST_API_URL` / `KV_REST_API_TOKEN` usage
- Entra-backed smoke checks

No existing application runtime code path is changed.

## Files

- Workflow: `.github/workflows/k3d-ephemeral-entra.yml`
- Helm chart: `deploy/ephemeral/helm/guard-ephemeral`
- KV REST adapter: `deploy/ephemeral/kv-rest-adapter`
- Smoke test: `scripts/smoke-entra-k3d.sh`
- Dockerfiles:
  - `gateway/Dockerfile`
  - `ui/Dockerfile`

## Trigger model

The workflow is intentionally separate from fast CI and runs on:

- `workflow_dispatch`
- pull request updates (`opened`, `synchronize`, `reopened`)

## Required GitHub secrets

Run `scripts/entra-ci-setup.sh` once (after `az login` and `gh auth login`); it creates the CI-only Entra app and sets all of these without printing them:

- `ENTRA_TENANT_ID`, `ENTRA_API_APP_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` — the same values the guard proxy uses (`scripts/dev.env`). The guard auto-derives its JWT trust from these.
- `ENTRA_CI_CLIENT_ID`, `ENTRA_CI_CLIENT_SECRET` — CI-only app with Graph `User.ReadWrite.All`, `AppRoleAssignment.ReadWrite.All`, `Application.Read.All`, plus delegated `access_as_user` on the API. Kept separate from the management app because that one is also used in prod and must not be able to create users.
- `ENTRA_CI_USER_DOMAIN` — tenant domain for the temporary user's login name.
- `MCP_GUARD_PUBLIC_KEY_PEM` — guest-demo PEM (unchanged).

Entra security defaults must be off for the tenant: the temporary user logs in with a password, which MFA blocks.

Operator auth mode:

- `gateway:admin` is a human-only App Role in Entra, so a robot client cannot hold it. At run start the workflow creates a temporary Entra user, assigns it `gateway:admin`, logs in as that user to get an operator token, and deletes (and purges) the user during cleanup.

## What the smoke test verifies

- Guard `/health` reports `kv_enabled: true`
- UI is reachable via ingress host
- Operator token can create (async, polled via `/agents/pending/:id`) and delete an Entra-backed agent via `/agents`
- Operator token can vend an agent access token via `/agents/:clientId/token`
- Guard `/audit` is readable with valid bearer

## Reusing the smoke test outside workflow

The same script can be used against localhost or hosted environments by changing env vars:

```bash
GUARD_BASE_URL=http://localhost:8787 \
UI_BASE_URL=http://localhost:5173 \
ENTRA_OPERATOR_BEARER_TOKEN=<entra access token for a user holding gateway:admin> \
AGENT_SCOPE=flights:read \
AGENT_SERVER_ID=demo \
./scripts/smoke-entra-k3d.sh
```

Notes:

- `UI_BASE_URL` is optional (UI check is skipped if unset).
- Script auto-cleans the created agent with `trap` on exit.
- For hosted runs, use a CI/test Entra tenant or constrained operator user to keep blast radius low.

## Notes

- This path is ephemeral CI validation only.
- Existing `ci.yml` remains unchanged for fast typecheck/test feedback.
- Existing localhost and hosted deployment docs remain the source of truth for current runtime paths.

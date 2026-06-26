# Backlog

Canonical tracker for open work. If an item is still in progress, track it here.

Use this file for planning and execution status. Keep shipped history in [CHANGELOG.md](CHANGELOG.md).

## Rules

1. One open item = one row with an owner and acceptance criteria.
2. Update status in this file as part of every PR that changes item state.
3. Move completed items to [CHANGELOG.md](CHANGELOG.md), then remove them here.
4. Keep design detail in docs; keep this file as the decision and execution index.

## Status legend

- `todo` not started
- `in-progress` active work
- `blocked` waiting on dependency/decision
- `done` completed in branch, pending release note

## P0 (next)

- BL-001
  priority: P0
  status: todo
  item: Harden agent audit ingest auth (`POST /audit/agent`)
  acceptance: Endpoint requires Bearer (`audit:write` or `gateway:admin`) or trusted mode; demo mode remains explicit
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#production-hardening-priorities-review)
- BL-002
  priority: P0
  status: todo
  item: Harden pending token disclosure (`GET /pending/:id`)
  acceptance: Optional Bearer gate or short poll token path for retries; docs updated with threat model
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#production-hardening-priorities-review)
- BL-003
  priority: P0
  status: todo
  item: Agent/Auth0 registry hygiene
  acceptance: Idempotent agent create, unique naming, reuse strategy, reconciliation notes
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#agent-registry--auth0-sync-sketch)
- BL-004
  priority: P0
  status: todo
  item: SDK packaging/distribution path
  acceptance: Package workflow documented and test publish flow validated
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#production-hardening-priorities-review)
- BL-005
  priority: P0
  status: todo
  item: External audit sink integration
  acceptance: Proxy can forward audit/otel events to external observability target
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#production-hardening-priorities-review)

## P1 (important)

- BL-006
  priority: P1
  status: todo
  item: Complete upstream structured errors
  acceptance: Consistent `upstream_unavailable` and mapped upstream failures on tools/call paths
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#tasks)
- BL-007
  priority: P1
  status: todo
  item: GUI-managed upstream secrets
  acceptance: Vendor secrets entered via UI and resolved from encrypted KV at runtime
  owner: unassigned
  source: [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md#production-hardening-priorities-review)

## Deferred

- BL-008
  priority: P3
  status: deferred
  item: Multi-server chat UI routing polish
  acceptance: Per-server chat UX expanded without reducing enforcement/audit clarity
  owner: unassigned
  source: [docs/ROADMAP.md](docs/ROADMAP.md#release-030--hardening--multi-server)
- BL-009
  priority: P3
  status: deferred
  item: Second mock MCP
  acceptance: Optional owned upstream added for routing-only demo coverage
  owner: unassigned
  source: [docs/ROADMAP.md](docs/ROADMAP.md#release-030--hardening--multi-server)

## Notes

- Historical planning context remains in [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md).
- New open work should be added here first.
# Next steps (post–0.2.0)

**Navigation:** [Roadmap](ROADMAP.md) · [Release process](RELEASE.md) · [Vercel deploy](vercel-deploy.md) · [CONCEPT](CONCEPT.md)

This doc captures **what to do after 0.2.0** — release housekeeping and the **0.3.0** backlog (peer-review priorities). Task numbers match [ROADMAP → 0.3.0](ROADMAP.md#release-030--hardening--multi-server).

---

## 0.2.0 — done

- [x] Merged to `main`; Vercel prod (UI + flight) on `96482e8` / PR #11
- [x] Tag `v0.2.0` pushed
- [x] Live smoke test (scope deny, dual audit, admin cancel)
- [ ] GitHub Releases page (optional — tag + CHANGELOG on `main` is enough)

Flight env (optional): `MCP_CORS_ORIGINS` — see [vercel-deploy → CORS](vercel-deploy.md#part-3--cors-020).

---

## What 0.2.0 proved

- JWT scope enforcement on MCP `tools/call` (server authoritative; client pre-check + intent audit).
- Dual audit correlation via `trace_id` / `session_id`.
- Remote browser → HTTPS flight MCP on Vercel with demo tokens.

The **enforcement path** is production-capable. Gaps are **platform and ops** (audit persistence, `/audit` auth, identity lifecycle, proxy for third-party MCP). **Do not refactor the enforcement core** for 0.3 — harden around it.

---

## 0.3.0 — recommended order

**Ship #1–#3 together first** on the public Vercel deploy — open `/audit` and a silent guard kill switch are the urgent gaps. KV (#4) fixes flaky panels but is second.

### Phase A — Public deploy hygiene (PR 1)

Do in **one PR** where possible:

| ROADMAP # | Work |
|-----------|------|
| 1 | Protect `GET /audit` (shared secret header via env, or remove route on public deploy) |
| 2 | `MCP_GUARD_ENABLED=false` — fail-closed or loud startup warning on public deploy |
| 3 | UI: show when server audit fetch fails (required once #1 is gated; today errors become empty panel) |

### Phase B — Reliable server audit on Vercel (PR 2)

| ROADMAP # | Work |
|-----------|------|
| 4 | Vercel KV (or Redis) for server audit append/read — fixes serverless instance split |

### Phase C — Security hygiene (PR 3)

| ROADMAP # | Work |
|-----------|------|
| 5 | JWT `iss` / `aud` validation (env-configured) — **before** any IdP wiring |
| 7 | Cap middleware body size (e.g. 1–4 MB) |

### Phase D — Multi-server client (1–2 PRs)

| ROADMAP # | Work |
|-----------|------|
| 6 | Single policy source + CI drift test |
| 8 | Agent selects server alias; MCP client uses `servers.*.url` |
| 9 | Optional `servers/notes/` mock with its own guard |

**Not in 0.3:** Real Slack/GitHub MCP URLs without a **guard proxy** (ROADMAP Tier 2 #11). Client-only scoping is UX, not authoritative for third-party endpoints.

### Phase E — Production platform (Tier 2)

- **IdP + OAuth/OIDC** — replaces `demo-tokens.json` with short-lived, issuer-minted JWTs (see below).
- Audit export to Loki/Datadog/OTel.
- HTTP **guard gateway** in front of arbitrary upstream MCP.
- Rate limiting.

---

## Demo tokens — no 0.3 work

`ui/public/demo-tokens.json` stays as-is for the public demo (**365-day** JWTs from `make keys`). No shorter expiry, no `make tokens`, no rotation automation in 0.3 — that would add operational overhead without real security until identity moves off static files.

**Production path:** Tier 2 **IdP integration** replaces demo tokens entirely; pair with 0.3 **#5 (`iss` / `aud`)** before wiring OAuth.

---

## Known demo limitations (documented, not bugs)

| Topic | Detail |
|-------|--------|
| Server audit on Vercel | In-memory per instance until KV (0.3 #4); panel may be empty intermittently |
| `GET /audit` | No auth today — **fix first** (0.3 #1) |
| Policy in three files | Must stay aligned manually until 0.3 #6 |
| `initialize` / `tools/list` | Unguarded — tool surface enumerable |
| Demo tokens | Static committed JWTs; acceptable for demo until **Tier 2 IdP** |
| Client audit | Browser tab memory; not tamper-proof |
| External MCP | No shared server log unless traffic hits **your** guarded hop |

See [CONCEPT → Current limitations](CONCEPT.md#current-limitations-demo) and [CONCEPT → Demo vs production](CONCEPT.md#demo-vs-production).

---

## Client scoping for remote MCP

The SDK already supports multiple servers in `gateway/config.yaml` (`authorize(server, tool, …)`). The UI only wires `flight`. **0.3 #8** adds routing; **Tier 2 proxy** adds authoritative enforcement for vendors you do not control.

---

## Related

- [ROADMAP.md](ROADMAP.md) — task checklist
- [RELEASE.md](RELEASE.md) — versioning and tag workflow
- [vercel-deploy.md](vercel-deploy.md) — deploy and troubleshooting

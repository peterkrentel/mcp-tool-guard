# Live demo — guard proxy in prod

**Navigation:** [Deploy overview](deploy-overview.md) · [Render deploy](render-deploy.md) · [README Live demo](../README.md#live-demo)

Five-minute script to prove **authoritative enforcement** on the Render guard proxy — for reviewers, stakeholders, or your own code walkthrough.

**This is the product demo** — not a tour of the repo or the chat UI. The system proves itself via API behavior: scoped JWT in → allow/deny out → `/audit` replay.

| Minimum viable demo | Optional |
|-------------------|----------|
| Demo 1 (proxy in path) + Demo 4 (curl deny) + Demo 5 (`/audit`) | UI chat, agent trace panel, WebLLM |

Do not extend the demo with more mock MCPs or UI features unless they show a **new** enforcement or audit story. See [ROADMAP → Build filter](ROADMAP.md#build-filter).

---

## Architecture (prod today)

```
Browser (Vercel UI)  →  Render guard proxy  →  Vercel flight MCP
                              ↑ JWT + scopes on tools/call
                              ↑ GET /audit (source: guard-proxy)
```

| Service | URL |
|---------|-----|
| **UI** | [mcp-tool-guard-ui.vercel.app](https://mcp-tool-guard-ui.vercel.app/) |
| **Guard proxy** | [mcp-tool-guard-proxy.onrender.com](https://mcp-tool-guard-proxy.onrender.com/health) |
| **Flight** | [mcp-tool-guard-flight-server.vercel.app/health](https://mcp-tool-guard-flight-server.vercel.app/health) |

Two-layer model:

| Layer | Where | Role |
|-------|-------|------|
| **Client pre-check** | Browser (`ui/src/agent.ts`) | UX — blocks obvious denies before network |
| **Proxy enforce** | Render (`gateway/proxy-server.ts`) | **Authoritative** — cannot bypass with a direct HTTP call |

---

## Demo 1 — Proxy is in the path (30 s)

1. Open [the UI](https://mcp-tool-guard-ui.vercel.app/).
2. Sign in (Auth0) or pick a guest JWT → **Initialize**.
3. Open **DevTools → Network**.
4. Chat: *Search flights from SFO to JFK*.

**Proof:** Requests go to `mcp-tool-guard-proxy.onrender.com` for `/mcp` and `/audit`, not directly to `mcp-tool-guard-flight-server.vercel.app`.

---

## Demo 2 — Read-only Auth0 user (2 min)

Use `demo-read@…` (or guest **read_only** token).

| Action | Audit panel | Proxy |
|--------|-------------|-------|
| Search flights | **Server** ALLOW | Request reaches proxy → allow |
| Book a flight | **Agent attempts** DENY only | No matching server row (blocked client-side) |

Screenshot reference: [prod-scope-deny-read-only.png](images/demo/prod-scope-deny-read-only.png).

**Talking point:** Client deny is fast UX; proxy is still the enforcement boundary for anything that hits the network.

---

## Demo 3 — Admin book + cancel (2 min)

Sign in as admin (full `flights:*` permissions).

1. Search → ALLOW in audit.
2. Book → ALLOW; chat shows booking id.
3. Cancel → ALLOW; may show **ALERT** in Render logs for `flights:delete`.

**Proof (Render dashboard → Logs):**

```
[MCPToolGuard] allow search_flights_tool
[MCPToolGuard] allow create_booking_tool
[MCPToolGuard ALERT] allow cancel_booking_tool
```

---

## Demo 4 — Proxy deny bypassing the UI (1 min)

Prove enforcement without the browser — direct `curl` to the proxy.

```bash
PROXY=https://mcp-tool-guard-proxy.onrender.com
# read_only token from ui/public/demo-tokens.json
TOKEN="<paste read_only JWT>"

curl -s -X POST "$PROXY/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_booking_tool","arguments":{"flight_id":"FL505","passenger_name":"Curl"}}}'
```

**Expected:** JSON-RPC error `code: -32001` (scope denied). Render log: `[MCPToolGuard] deny create_booking_tool`.

**Important:** Include `Accept: application/json, text/event-stream` — curl’s default breaks SSE forwarding to flight.

---

## Demo 5 — Audit API (30 s)

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$PROXY/audit" | jq '.source'
# → "guard-proxy"
```

---

## Code review path (after the demo)

Read in this order to understand the flow:

| Order | File | What you learn |
|-------|------|----------------|
| 1 | [deploy-overview.md](deploy-overview.md) | Local vs prod paths |
| 2 | `gateway/config.yaml` + `config.prod.yaml` | Policy: server → url + tool → scope |
| 3 | `gateway/guard.ts` | JWT verify, `authorize()`, deny reasons |
| 4 | `gateway/proxy-server.ts` | Routes, enforce on `tools/call`, forward, `/audit` |
| 5 | `ui/src/agent.ts` | Client pre-check before MCP |
| 6 | `ui/src/mcp-client.ts` | Headers (`Accept`, Bearer, trace) |
| 7 | `ui/src/audit-view.ts` | Three panels, session filter |

**One request to trace:** chat → `agent.ts` authorize → `mcp-client.ts` POST → proxy `handleMcp` → `guard.authorize` → forward to flight.

---

## Next: external MCP

Wire a real vendor URL in `gateway/config.prod.yaml` under `servers:`, then call:

```
POST https://mcp-tool-guard-proxy.onrender.com/{serverId}/mcp
```

UI still targets flight only until [#9 multi-server UI](ROADMAP.md) — external MCP is proxy + curl/SDK first. See [CONCEPT → unowned MCP](CONCEPT.md#third-party--unowned-mcp).

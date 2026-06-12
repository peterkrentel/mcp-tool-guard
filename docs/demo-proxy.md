# Live demo — guard proxy in prod

**Navigation:** [Deploy overview](deploy-overview.md) · [Render deploy](render-deploy.md) · [Cursor guide](cursor-guide.md) · [README Live demo](../README.md#live-demo)

Five-minute script to prove **authoritative enforcement** on the Render guard proxy — for reviewers, stakeholders, or your own code walkthrough.

**This is the product demo** — not a tour of the repo or the chat UI. The system proves itself via API behavior: scoped JWT in → allow/deny out → `/audit` replay.

| Minimum viable demo | Optional |
|-------------------|----------|
| **Demo 6** (GitHub curl allow) + Render logs · or flight **Demo 4** (curl deny) + **Demo 5** (`/audit`) | UI chat, agent trace panel, WebLLM |

**Track 2 prod proof (screenshots + checklist):** [track2-github-proof.md](track2-github-proof.md).

Do not extend the demo with more mock MCPs or UI features unless they show a **new** enforcement or audit story. See [ROADMAP → Build filter](ROADMAP.md#build-filter).

---

## Architecture (prod today)

```
Browser / curl  →  Render guard proxy  →  upstream MCP
                      ↑ JWT scopes        flight (Vercel)  OR  github (GitHub Copilot)
                      ↑ GET /audit
                      ↑ GITHUB_MCP_TOKEN (upstream only — github server)
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

## Demo 6 — GitHub MCP (external upstream) {#demo-6--github-mcp-external-upstream}

**Prod proof recorded:** [track2-github-proof.md](track2-github-proof.md) (curl allow + Render logs, June 2026).

Prove scope enforcement on a **vendor MCP you do not control**. The proxy substitutes `GITHUB_MCP_TOKEN` for upstream auth — callers still present their **Auth0 M2M JWT** for scope checks. The PAT never appears in responses or audit rows.

![curl allow — get_file_contents returns README](images/demo/track2-github-curl-read-allow.png)

![Render logs — proxy and mcp allow](images/demo/track2-github-render-logs.png)

**Prerequisites**

1. Add `repo:read` and `repo:write` permissions to your Auth0 API (`https://mcp-tool-guard`).
2. Set `GITHUB_MCP_TOKEN` on Render (fine-grained PAT with repo access for the demo repo).
3. Redeploy proxy. `GET /health` → `"upstream_auth_missing": []` (empty when PAT is set).
4. Create a read-only M2M agent on [`/agents.html`](../ui/agents.html): MCP server **github**, scopes `repo:read` → **Use** to vend token. (Same as `POST /agents` with `"scopes": ["repo:read"], "serverId": "github"`.)

**Discover real tool names** (optional — policy in yaml may need tuning):

```bash
curl -s "$PROXY/servers/github/tools" | jq '.tools[].name'
```

**Allow — read-scoped agent token**

```bash
PROXY=https://mcp-tool-guard-proxy.onrender.com
TOKEN="<M2M agent JWT with repo:read>"

curl -s -X POST "$PROXY/github/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_file_contents","arguments":{"owner":"YOUR_ORG","repo":"YOUR_REPO","path":"README.md"}}}'
```

**SSE note:** GitHub MCP responses are `text/event-stream`. Pipe through `grep '^data: '` before `jq` (see [track2-github-proof.md](track2-github-proof.md)).

**Deny — write tool without repo:write (proxy blocks before GitHub)**

```bash
curl -s -X POST "$PROXY/github/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_or_update_file","arguments":{}}}'
```

**Expected:** JSON-RPC error `code: -32001` (scope denied). Render log: `[MCPToolGuard] deny create_or_update_file`.

**Audit**

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$PROXY/audit" | jq '.entries[-3:]'
```

**Talking point:** Same JWT scope model as flight — different upstream credential for the vendor MCP.

**Browser demo:** keep [Flight demo `/`](../ui/index.html) **Server enforcement** panel for enforce + audit; use [`/agents.html`](../ui/agents.html) to provision github agents until Track 3 approval UI lands.

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

**Implement next:** [cursor-guide.md](cursor-guide.md) Track 3 (approval queue).

**GitHub request to trace:** curl/agent JWT → `POST /github/mcp` → proxy `authorize(repo:read)` → forward with `GITHUB_MCP_TOKEN` → GitHub MCP → SSE result.

**Flight request to trace:** chat → `agent.ts` authorize → `mcp-client.ts` POST `/mcp` → proxy → flight.

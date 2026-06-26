# OpenTelemetry — guard proxy (feat/otel-telemetry)

**Navigation:** [Render deploy](render-deploy.md) · [NEXT-STEPS → audit sink](NEXT-STEPS.md) · [ARCHITECTURE](ARCHITECTURE.md)

Tracking doc for additive OTel instrumentation on the Render guard proxy. **No changes** to audit logic, rate limiting, approval queue, or JWT verification.

---

## Goal

Export manual spans to Grafana Tempo (or any OTLP HTTP collector) for enforce + upstream + agent intent + Gemini latency. Correlate layers with existing **`mcp.trace_id`** (`X-Trace-Id` header / audit field) — **not** as a replacement for W3C trace IDs.

---

## Env vars (Render)

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | **Yes** (to enable) | — | Base URL, e.g. `https://tempo.example.com:4318` — exporter appends `/v1/traces` |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | — | `Authorization=Basic …,X-Scope-OrgID=…` (comma-separated `key=value`) |
| `OTEL_SERVICE_NAME` | No | `mcp-tool-guard-proxy` | Matches `/health` `service` |
| `OTEL_SDK_DISABLED` | No | — | Set `true` to force no-op even if endpoint set |

If `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, the SDK is **not** initialized — proxy behaves exactly as before.

---

## Instrumentation points

| Span name | File | Trigger | Key attributes |
|-----------|------|---------|----------------|
| `mcp.proxy.tools_call` | `gateway/proxy-server.ts` | Every `tools/call` proxy decision when guard enabled | `mcp.tool.name`, `server.id`, `mcp.decision` (`allow` \| `deny` \| `pending`), `agent.scopes`, `mcp.trace_id`, `pending_id`, `approval.via_token` |
| `mcp.agent.intent` | `gateway/proxy-server.ts` | Each entry on `POST /audit/agent` | `mcp.tool.name`, `mcp.decision`, `mcp.trace_id`, `source=agent` |
| `mcp.upstream.forward` | `gateway/mcp-upstream.ts` | Every `forwardMcpPost` | `mcp.tool.name`, `server.id`, `http.response.status_code`, `latency_ms`, `mcp.trace_id` — child of active proxy span when present |
| `llm.gemini.complete` | `gateway/llm-proxy.ts` | Gemini `fetch` in `geminiComplete` | `llm.model`, `llm.provider=gemini`, `latency_ms` |

---

## Implementation checklist

- [x] `docs/otel.md` (this file)
- [x] `gateway/telemetry.ts` — init, no-op helpers, SIGTERM flush
- [x] Explicit deps: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`
- [x] `import "./telemetry.js"` first in `proxy-server.ts`
- [x] Proxy decision spans at all `handleMcp` exit paths (allow / deny / pending / approval-token allow)
- [x] Agent intent spans in `handleAuditAgentPost` (one per entry)
- [x] Upstream span in `forwardMcpPost`
- [x] Gemini span in `llm-proxy.ts`
- [x] `render-deploy.md` env table + `[Unreleased]` CHANGELOG

---

## Acceptance (prod / local)

- [ ] Proxy starts with **no** OTel env → identical behavior, no startup noise
- [ ] Proxy starts with **bad** OTLP endpoint → does **not** crash; export errors swallowed
- [ ] One `tools/call` turn → spans in Tempo searchable by `mcp.trace_id`
- [ ] Approval queue → span with `mcp.decision=pending` and `pending_id`
- [ ] Render redeploy (SIGTERM) → spans flushed (spot-check in collector)
- [ ] `npm run build -w @mcp-tool-guard/gateway` / CI green

---

## Grafana query examples

```text
{ mcp.trace_id = "<uuid-from-X-Trace-Id>" }
{ span.name = "mcp.proxy.tools_call" && server.id = "github" }
{ span.name = "mcp.upstream.forward" && http.response.status_code >= 400 }
```

---

## Non-goals (v1)

- HTTP auto-instrumentation middleware
- Spans for `initialize` / `tools/list`
- Groq/Mistral server spans (browser-only today)
- Replacing KV `/audit` with OTel

---

## Branch

`feat/otel-telemetry` — merge via PR after acceptance checks.

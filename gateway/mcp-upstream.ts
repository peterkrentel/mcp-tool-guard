import { context, type Context } from "@opentelemetry/api";

import type { AuditLogger } from "./logger.js";
import { recordUpstreamForward } from "./telemetry.js";
import type { AuditLogEntry } from "./types.js";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

// When we re-stream fetch body chunks, these can become invalid for the forwarded
// response and trigger downstream parser errors (e.g. Vite dev proxy).
const UNSAFE_STREAMED_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-encoding",
]);

const MCP_CAPTURE_MAX = 2048;

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function truncate(text: string, max = MCP_CAPTURE_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function parseSsePreview(body: string): string {
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) return truncate(body);
  try {
    const parsed = JSON.parse(dataLine.slice(6)) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (parsed.error?.message) return truncate(parsed.error.message);
    return truncate(JSON.stringify(parsed.result ?? parsed));
  } catch {
    return truncate(dataLine);
  }
}

export interface UpstreamErrorBody {
  error: "upstream_unavailable";
  server: string;
  upstream_status?: number;
  detail: string;
}

export function upstreamErrorBody(
  serverId: string,
  cause: unknown,
  upstreamStatus?: number,
): UpstreamErrorBody {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return {
    error: "upstream_unavailable",
    server: serverId,
    ...(upstreamStatus !== undefined ? { upstream_status: upstreamStatus } : {}),
    detail,
  };
}

export interface ForwardMcpOptions {
  upstreamUrl: string;
  reqHeaders: Record<string, string | string[] | undefined>;
  body: Buffer;
  res: import("node:http").ServerResponse;
  /** Registry server id — used for OTel when audit block is absent. */
  serverId?: string;
  /** When set, replaces caller Authorization on the upstream request (vendor PAT). */
  upstreamBearer?: string;
  audit?: {
    logger: AuditLogger;
    serverId: string;
    toolName: string;
    traceId?: string;
    sessionId?: string;
  };
}

function emitUpstreamTelemetry(
  options: ForwardMcpOptions,
  traceId: string | undefined,
  statusCode: number,
  latencyMs: number,
  decision: "allow" | "deny",
  parentCtx: Context,
): void {
  recordUpstreamForward(
    {
      serverId: options.audit?.serverId ?? options.serverId ?? "unknown",
      toolName: options.audit?.toolName,
      traceId: options.audit?.traceId ?? traceId,
      statusCode,
      latencyMs,
      decision,
    },
    parentCtx,
  );
}

/** Forward POST to upstream MCP; stream response and log MCP-layer audit entry. */
export async function forwardMcpPost(options: ForwardMcpOptions): Promise<void> {
  const { upstreamUrl, reqHeaders, body, res, audit, upstreamBearer } = options;
  const parentCtx = context.active();

  const forwardHeaders: Record<string, string> = {
    "Content-Type": header(reqHeaders, "content-type") ?? "application/json",
    Accept: header(reqHeaders, "accept") ?? "application/json, text/event-stream",
  };
  if (upstreamBearer) {
    forwardHeaders.Authorization = `Bearer ${upstreamBearer}`;
  } else {
    const auth = header(reqHeaders, "authorization");
    if (auth) forwardHeaders.Authorization = auth;
  }
  const traceId = header(reqHeaders, "x-trace-id");
  if (traceId) forwardHeaders["X-Trace-Id"] = traceId;
  const sessionId = header(reqHeaders, "x-session-id");
  if (sessionId) forwardHeaders["X-Session-Id"] = sessionId;

  const start = performance.now();
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: forwardHeaders,
      body: new Uint8Array(body),
    });
  } catch (err) {
    const latencyMs = performance.now() - start;
    if (audit) {
      const message = err instanceof Error ? err.message : String(err);
      logMcpAudit(audit, 0, message, latencyMs, "deny");
    }
    emitUpstreamTelemetry(options, traceId, 0, latencyMs, "deny", parentCtx);
    throw err;
  }

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (!HOP_BY_HOP.has(normalized) && !UNSAFE_STREAMED_RESPONSE_HEADERS.has(normalized)) {
      res.setHeader(key, value);
    }
  });

  if (!upstream.body) {
    const latencyMs = performance.now() - start;
    if (audit) {
      logMcpAudit(audit, upstream.status, "", latencyMs);
    }
    emitUpstreamTelemetry(
      options,
      traceId,
      upstream.status,
      latencyMs,
      upstream.status >= 400 ? "deny" : "allow",
      parentCtx,
    );
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  let captured = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
      if (captured.length < MCP_CAPTURE_MAX) {
        captured += Buffer.from(value).toString("utf8");
      }
    }
  } finally {
    res.end();
    const latencyMs = performance.now() - start;
    let mcpDecision: "allow" | "deny" = upstream.status >= 400 ? "deny" : "allow";
    if (audit) {
      const contentType = upstream.headers.get("content-type") ?? "";
      const preview = contentType.includes("text/event-stream")
        ? parseSsePreview(captured)
        : truncate(captured);
      mcpDecision =
        preview.includes("error") || upstream.status >= 400 ? "deny" : "allow";
      logMcpAudit(audit, upstream.status, preview, latencyMs, mcpDecision);
    }
    emitUpstreamTelemetry(
      options,
      traceId,
      upstream.status,
      latencyMs,
      mcpDecision,
      parentCtx,
    );
  }
}

function logMcpAudit(
  audit: NonNullable<ForwardMcpOptions["audit"]>,
  status: number,
  preview: string,
  durationMs: number,
  decision: "allow" | "deny" = "allow",
): void {
  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    decision,
    server: audit.serverId,
    tool: audit.toolName,
    required_scope: "",
    token_scopes: [],
    source: "mcp",
    upstream_status: status,
    response_preview:
      process.env.NODE_ENV === "production"
        ? undefined
        : preview || undefined,
    duration_ms: Math.round(durationMs),
    trace_id: audit.traceId,
    session_id: audit.sessionId,
    reason: decision === "deny" ? preview || `HTTP ${status}` : undefined,
  };
  audit.logger.log(entry);
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params?: unknown;
}

async function mcpJsonRpc(
  url: string,
  method: string,
  params: unknown,
  bearer?: string,
): Promise<unknown> {
  const body: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method, params };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`MCP ${method} HTTP ${res.status}: ${await res.text()}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) throw new Error("No SSE data in MCP response");
    const parsed = JSON.parse(dataLine.slice(6)) as { result?: unknown; error?: { message: string } };
    if (parsed.error) throw new Error(parsed.error.message);
    return parsed.result;
  }

  const parsed = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (parsed.error) throw new Error(parsed.error.message);
  return parsed.result;
}

/**
 * GET /servers/:id/tools — discover tools from upstream MCP (tools/list).
 * Auth required: no; optional Bearer forwarded to upstream.
 */
export async function discoverMcpTools(
  upstreamUrl: string,
  bearer?: string,
  upstreamBearer?: string,
): Promise<unknown[]> {
  const auth = upstreamBearer ?? bearer;
  await mcpJsonRpc(
    upstreamUrl,
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-tool-guard-proxy", version: "0.4.0" },
    },
    auth,
  );
  const result = (await mcpJsonRpc(upstreamUrl, "tools/list", {}, auth)) as {
    tools?: unknown[];
  };
  return result.tools ?? [];
}

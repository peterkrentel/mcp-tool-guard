/**
 * Optional OpenTelemetry for the guard proxy.
 * No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset or OTEL_SDK_DISABLED=true.
 */

import { context, SpanStatusCode, trace, type Context } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";

export type ProxyDecision = "allow" | "deny" | "pending";

export interface ProxyDecisionAttrs {
  toolName: string;
  serverId: string;
  decision: ProxyDecision;
  agentScopes: string[];
  traceId?: string;
  pendingId?: string;
  approvalViaToken?: boolean;
}

export interface AgentIntentAttrs {
  toolName: string;
  decision: string;
  traceId?: string;
}

export interface UpstreamForwardAttrs {
  serverId: string;
  toolName?: string;
  traceId?: string;
  statusCode: number;
  latencyMs: number;
  decision: "allow" | "deny";
}

const TRACER_NAME = "mcp-tool-guard-proxy";
const SHUTDOWN_FLUSH_TIMEOUT_MS = 5000;

let sdk: NodeSDK | null = null;
let loggerProvider: LoggerProvider | null = null;
let stopConsoleBridge: (() => void) | null = null;
let enabled = false;
let shuttingDown = false;

function tracesEndpointFromBase(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/traces")) return trimmed;
  if (trimmed.endsWith("/v1/logs")) {
    return `${trimmed.slice(0, -"/v1/logs".length)}/v1/traces`;
  }
  return `${trimmed}/v1/traces`;
}

function logsEndpointFromBase(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/logs")) return trimmed;
  if (trimmed.endsWith("/v1/traces")) {
    return `${trimmed.slice(0, -"/v1/traces".length)}/v1/logs`;
  }
  return `${trimmed}/v1/logs`;
}

function stringifyConsoleArgs(args: unknown[]): string {
  return args
    .map((part) => {
      if (typeof part === "string") return part;
      if (part instanceof Error) return part.stack ?? part.message;
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .join(" ");
}

function installConsoleBridge(): () => void {
  const logger = logs.getLogger(TRACER_NAME);
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  let emitting = false;

  const wrap = (
    method: keyof typeof originals,
    severityNumber: SeverityNumber,
    severityText: string,
  ): void => {
    console[method] = (...args: unknown[]) => {
      originals[method](...args);
      if (emitting) return;
      try {
        emitting = true;
        logger.emit({
          severityNumber,
          severityText,
          body: stringifyConsoleArgs(args),
          attributes: {
            "log.source": "console",
          },
        });
      } catch {
        // best-effort log forwarding
      } finally {
        emitting = false;
      }
    };
  };

  wrap("log", SeverityNumber.INFO, "INFO");
  wrap("info", SeverityNumber.INFO, "INFO");
  wrap("warn", SeverityNumber.WARN, "WARN");
  wrap("error", SeverityNumber.ERROR, "ERROR");

  return () => {
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
  };
}

function parseOtlpHeaders(raw: string | undefined): Record<string, string> | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const headers: Record<string, string> = {};
  for (const part of trimmed.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) headers[key] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function proxySpanAttributes(attrs: ProxyDecisionAttrs): Record<string, string | boolean> {
  return {
    "mcp.tool.name": attrs.toolName,
    "server.id": attrs.serverId,
    "mcp.decision": attrs.decision,
    "agent.scopes": attrs.agentScopes.join(","),
    ...(attrs.traceId ? { "mcp.trace_id": attrs.traceId } : {}),
    ...(attrs.pendingId ? { pending_id: attrs.pendingId } : {}),
    ...(attrs.approvalViaToken ? { "approval.via_token": true } : {}),
  };
}

export function telemetryEnabled(): boolean {
  return enabled;
}

export function initTelemetry(): void {
  if (enabled || sdk) return;
  if (process.env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") return;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return;

  if (!process.env.OTEL_SERVICE_NAME?.trim()) {
    process.env.OTEL_SERVICE_NAME = "mcp-tool-guard-proxy";
  }
  const serviceName = process.env.OTEL_SERVICE_NAME;

  const headers = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  const sharedResource = new Resource({
    "service.name": serviceName,
  });
  const tracesUrl = tracesEndpointFromBase(endpoint);
  const logsUrl = logsEndpointFromBase(endpoint);

  try {
    const exporter = new OTLPTraceExporter({
      url: tracesUrl,
      ...(headers ? { headers } : {}),
    });

    const logExporter = new OTLPLogExporter({
      url: logsUrl,
      ...(headers ? { headers } : {}),
    });

    loggerProvider = new LoggerProvider({ resource: sharedResource });
    loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));
    logs.setGlobalLoggerProvider(loggerProvider);

    sdk = new NodeSDK({
      serviceName,
      resource: sharedResource,
      traceExporter: exporter,
    });

    sdk.start();
    stopConsoleBridge = installConsoleBridge();
    enabled = true;
    console.info(
      `[MCPToolGuard proxy] OpenTelemetry enabled (service=${serviceName})`,
    );

    const shutdown = (): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (stopConsoleBridge) {
        stopConsoleBridge();
        stopConsoleBridge = null;
      }

      const flushPromises: Array<Promise<void>> = [];
      if (sdk) {
        flushPromises.push(
          sdk.shutdown().catch(() => {
            /* best-effort trace flush on shutdown */
          }),
        );
      }
      if (loggerProvider) {
        flushPromises.push(
          loggerProvider.shutdown().catch(() => {
            /* best-effort log flush on shutdown */
          }),
        );
      }
      const flush = Promise.allSettled(flushPromises);

      const timeout = new Promise<void>((resolve) => {
        setTimeout(resolve, SHUTDOWN_FLUSH_TIMEOUT_MS);
      });

      void Promise.race([flush, timeout]).finally(() => {
        process.exit(0);
      });
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch {
    console.warn("[MCPToolGuard proxy] OpenTelemetry init failed — continuing without telemetry");
    if (stopConsoleBridge) {
      stopConsoleBridge();
      stopConsoleBridge = null;
    }
    loggerProvider = null;
    sdk = null;
    enabled = false;
  }
}

/** Point-in-time span for deny / pending proxy decisions. */
export function recordProxyDecision(attrs: ProxyDecisionAttrs, parentCtx?: Context): void {
  if (!enabled) return;
  const tracer = trace.getTracer(TRACER_NAME);
  const ctx = parentCtx ?? context.active();
  tracer.startActiveSpan(
    "mcp.proxy.tools_call",
    { attributes: proxySpanAttributes(attrs) },
    ctx,
    (span) => {
      if (attrs.decision === "deny") {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
    },
  );
}

/** Active span for allow path — upstream span nests as child. */
export async function withProxyAllowSpan<T>(
  attrs: Omit<ProxyDecisionAttrs, "decision"> & {
    decision?: "allow";
    pendingId?: string;
    approvalViaToken?: boolean;
  },
  fn: () => Promise<T>,
): Promise<T> {
  if (!enabled) return fn();
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    "mcp.proxy.tools_call",
    { attributes: proxySpanAttributes({ ...attrs, decision: "allow" }) },
    async (span) => {
      try {
        return await fn();
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export function recordAgentIntent(attrs: AgentIntentAttrs, parentCtx?: Context): void {
  if (!enabled) return;
  const tracer = trace.getTracer(TRACER_NAME);
  const ctx = parentCtx ?? context.active();
  tracer.startActiveSpan(
    "mcp.agent.intent",
    {
      attributes: {
        "mcp.tool.name": attrs.toolName,
        "mcp.decision": attrs.decision,
        source: "agent",
        ...(attrs.traceId ? { "mcp.trace_id": attrs.traceId } : {}),
      },
    },
    ctx,
    (span) => {
      span.end();
    },
  );
}

/** Request root span for proxy route handling. */
export async function withHttpRequestSpan<T>(
  attrs: { method: string; path: string },
  fn: () => Promise<T>,
): Promise<T> {
  if (!enabled) return fn();
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    "http.server.request",
    {
      attributes: {
        "http.request.method": attrs.method,
        "url.path": attrs.path,
      },
    },
    async (span) => {
      try {
        return await fn();
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export function recordUpstreamForward(attrs: UpstreamForwardAttrs, parentCtx?: Context): void {
  if (!enabled) return;
  const tracer = trace.getTracer(TRACER_NAME);
  const ctx = parentCtx ?? context.active();
  const span = tracer.startSpan(
    "mcp.upstream.forward",
    {
      attributes: {
        "server.id": attrs.serverId,
        ...(attrs.toolName ? { "mcp.tool.name": attrs.toolName } : {}),
        ...(attrs.traceId ? { "mcp.trace_id": attrs.traceId } : {}),
        "http.response.status_code": attrs.statusCode,
        latency_ms: Math.round(attrs.latencyMs),
        "mcp.decision": attrs.decision,
      },
    },
    ctx,
  );
  if (attrs.decision === "deny" || attrs.statusCode >= 400) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
  span.end();
}

const GEMINI_MODEL = "gemini-3.1-flash-lite";

export async function withGeminiSpan<T>(fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();
  const tracer = trace.getTracer(TRACER_NAME);
  const start = performance.now();
  return tracer.startActiveSpan(
    "llm.gemini.complete",
    {
      attributes: {
        "llm.model": GEMINI_MODEL,
        "llm.provider": "gemini",
      },
    },
    async (span) => {
      try {
        const result = await fn();
        span.setAttribute("latency_ms", Math.round(performance.now() - start));
        return result;
      } catch (err) {
        span.setAttribute("latency_ms", Math.round(performance.now() - start));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

initTelemetry();

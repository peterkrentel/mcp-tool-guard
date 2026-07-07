/**
 * Guard HTTP proxy (#12) + agent gateway (stage 1, in-memory).
 *
 * MCP routes:
 *   POST /mcp              → default server (MCP_PROXY_DEFAULT_SERVER)
 *   POST /:serverId/mcp    → configured upstream
 *
 * Registry:
 *   GET    /servers           — list registered MCP servers
 *   POST   /servers           — add server (gateway:admin when IdP trust enabled)
 *   DELETE /servers/:id       — remove server (gateway:admin)
 *   GET    /servers/:id/tools — discover tools/list from upstream
 *
 * Agents (Auth0 M2M):
 *   GET    /agents            — list agents from KV (when configured)
 *   POST   /agents            — create M2M client (gateway:admin)
 *   POST   /agents/:clientId/token — vend JWT from server-stored secret (gateway:admin)
 *   POST   /token             — vend client_credentials JWT (gateway:admin)
 *
 * Audit:
 *   GET    /audit             — all layers (agent, proxy, mcp)
 *   POST   /audit/agent       — append agent-layer entries from browser
 *   GET    /health            — status
 */

import "./telemetry.js";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { context } from "@opentelemetry/api";
import { parse as parseYaml } from "yaml";

import { encryptClientSecret } from "./agent-secrets.js";
import {
  buildAgentRecord,
  deleteAgent,
  getAgentClientSecret,
  listAgents,
  saveAgent,
} from "./agent-store.js";
import {
  adminAuthRequired,
  GATEWAY_ADMIN_SCOPE,
  identifyBearer,
  requireGatewayAdmin,
} from "./admin-auth.js";
import { createM2mAgent, deleteM2mAgent } from "./auth0-mgmt.js";
import { missingUpstreamEnvNames, resolveGuardConfig } from "./config-resolver.js";
import { kvEnabled } from "./kv.js";
import { loadServersFromKv, persistServer, removeServerFromKv } from "./registry-kv.js";
import {
  auditAgentTrustedMode,
  corsAllowOrigins,
  guardEnabled,
  jwtTrustFromEnv,
  readPublicKeyPem,
} from "./env.js";
import { ToolGuard } from "./guard.js";
import {
  discoverMcpTools,
  forwardMcpPost,
  upstreamErrorBody,
} from "./mcp-upstream.js";
import {
  createPendingRequest,
  generatePendingPollToken,
  generateApprovalToken,
  getApprovalTokenForPending,
  getPendingRequest,
  listPendingRequests,
  resolvePendingRequest,
  validateApprovalToken,
  validatePendingPollToken,
} from "./pending-store.js";
import { clientIp, kvRateLimitExceeded, SlidingWindowRateLimiter } from "./rate-limit.js";
import { ServerRegistry } from "./server-registry.js";
import {
  recordAgentIntent,
  recordProxyDecision,
  withHttpRequestSpan,
  withProxyAllowSpan,
} from "./telemetry.js";
import {
  auth0AudienceFromEnv,
  tokenVendorFromEnv,
} from "./token-vendor.js";
import { geminiComplete, geminiConfigured } from "./llm-proxy.js";
import type { AuditLogEntry, GuardConfig, ServerConfig } from "./types.js";

function gatewayRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return here.endsWith(`${sep}dist`) ? resolve(here, "..") : here;
}

const gatewayDir = gatewayRoot();
const DEFAULT_PORT = 8787;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT = new SlidingWindowRateLimiter(RATE_LIMIT_MAX, 60_000);
const APPROVAL_QUEUE_ENABLED =
  process.env.MCP_APPROVAL_QUEUE?.trim().toLowerCase() === "true";

function loadYamlConfig(): GuardConfig {
  const configPath =
    process.env.MCP_PROXY_CONFIG?.trim() ||
    resolve(gatewayDir, "config.yaml");
  const raw = readFileSync(configPath, "utf8");
  return resolveGuardConfig(parseYaml(raw) as GuardConfig);
}

function upstreamAuthMissing(serverCfg: ServerConfig): string | null {
  const envName = serverCfg.upstream_token_env?.trim();
  if (!envName || serverCfg.upstream_token) return null;
  return envName;
}

function buildReqHeadersWithUpstreamAuth(
  req: IncomingMessage,
  serverCfg: ServerConfig,
): Record<string, string | string[] | undefined> {
  if (!serverCfg.upstream_token) return req.headers;
  const headers = { ...req.headers };
  headers.authorization = `Bearer ${serverCfg.upstream_token}`;
  return headers;
}

function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origins = corsAllowOrigins();
  const origin = header(req, "origin");
  if (origin && (origins.includes("*") || origins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, X-Trace-Id, X-Session-Id, X-Approval-Token, X-Agent-Id",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

async function readBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      throw new Error(`Request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const body = await readBody(req);
  return JSON.parse(body.toString("utf8")) as T;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", String(Buffer.byteLength(payload)));
  res.end(payload);
}

function sendJsonRpcError(
  res: ServerResponse,
  requestId: unknown,
  message: string,
  status = 403,
): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId ?? null,
    error: { code: -32001, message },
  });
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.end(body);
}

function sendJsonRpcPending(
  res: ServerResponse,
  requestId: unknown,
  pendingId: string,
  pendingPollToken: string,
): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId ?? null,
    result: {
      status: "pending",
      pending_id: pendingId,
      pending_poll_token: pendingPollToken,
      message: "Awaiting approval",
    },
  });
  res.statusCode = 202;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.end(body);
}

function matchMcpRoute(
  pathname: string,
  defaultServer: string,
): { serverId: string } | null {
  if (pathname === "/mcp" || pathname === "/mcp/") {
    return { serverId: defaultServer };
  }
  const match = pathname.match(/^\/([^/]+)\/mcp\/?$/);
  if (match) return { serverId: match[1] };
  return null;
}

function syncGuardConfig(guard: ToolGuard, registry: ServerRegistry): void {
  guard.replaceConfig(registry.toGuardConfig());
}

async function handleAudit(
  guard: ToolGuard,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  /** GET /audit — returns agent, proxy, and mcp entries. Auth: Bearer when guard enabled. */
  if (guardEnabled()) {
    const bearer = extractBearer(header(req, "authorization"));
    if (!bearer) {
      sendJson(res, 401, { error: "Missing Authorization: Bearer" });
      return;
    }
    try {
      await guard.validateToken(bearer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 401, { error: `JWT validation failed: ${message}` });
      return;
    }
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const sessionId = url.searchParams.get("session_id") ?? undefined;
  let entries = [...guard.logger.getEntries()];
  if (sessionId) {
    entries = entries.filter((e) => e.session_id === sessionId);
  }
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? "200"), 500));
  sendJson(res, 200, {
    entries: entries.slice(-limit),
    sources: ["agent", "proxy", "mcp"],
  });
}

async function handleAuditAgentPost(
  guard: ToolGuard,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  /**
   * POST /audit/agent — append agent-layer intent entries.
   * Auth: Bearer with `audit:write` or `gateway:admin`, unless explicit trusted demo mode is enabled.
   */
  if (guardEnabled() && !auditAgentTrustedMode()) {
    const bearer = extractBearer(header(req, "authorization"));
    if (!bearer) {
      sendJson(res, 401, {
        error: "Missing Authorization: Bearer (audit:write or gateway:admin required)",
      });
      return;
    }

    try {
      const { scopes } = await guard.validateToken(bearer);
      const canWriteAudit =
        guard.hasScope(scopes, "audit:write") ||
        guard.hasScope(scopes, GATEWAY_ADMIN_SCOPE);
      if (!canWriteAudit) {
        sendJson(res, 403, {
          error: "Missing required permission 'audit:write' or 'gateway:admin'",
        });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 401, { error: `JWT validation failed: ${message}` });
      return;
    }
  }

  const requestCtx = context.active();
  const body = await readJson<{ entries?: AuditLogEntry[]; entry?: AuditLogEntry }>(req);
  const items = body.entries ?? (body.entry ? [body.entry] : []);
  for (const raw of items) {
    const entry: AuditLogEntry = {
      ...raw,
      source: "agent",
      timestamp: raw.timestamp ?? new Date().toISOString(),
      decision: raw.decision ?? "allow",
      server: raw.server ?? "",
      tool: raw.tool ?? "",
      required_scope: raw.required_scope ?? "",
      token_scopes: raw.token_scopes ?? [],
    };
    guard.logger.log(entry);
    recordAgentIntent({
      toolName: entry.tool,
      decision: entry.decision,
      traceId: entry.trace_id,
    }, requestCtx);
  }
  sendJson(res, 200, { ok: true, count: items.length });
}

async function handleMcp(
  guard: ToolGuard,
  registry: ServerRegistry,
  serverId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const serverCfg = registry.getServer(serverId);
  if (!serverCfg) {
    sendJson(res, 404, { error: `Unknown server '${serverId}'` });
    return;
  }

  const missingUpstream = upstreamAuthMissing(serverCfg);
  if (missingUpstream) {
    sendJson(res, 503, {
      error: `Upstream credential not configured — set ${missingUpstream} on the proxy`,
    });
    return;
  }

  const forwardHeaders = buildReqHeadersWithUpstreamAuth(req, serverCfg);
  const upstreamBearer = serverCfg.upstream_token;

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 413, { error: message });
    return;
  }

  let payload: { method?: string; params?: { name?: string }; id?: unknown };
  try {
    payload = JSON.parse(body.toString("utf8")) as typeof payload;
  } catch {
    await forwardMcpPost({
      upstreamUrl: serverCfg.url,
      reqHeaders: forwardHeaders,
      body,
      res,
      serverId,
      upstreamBearer,
    });
    return;
  }

  const toolName = payload.params?.name ?? "";
  const traceId = header(req, "x-trace-id");
  const sessionId = header(req, "x-session-id");
  const requestCtx = context.active();

  let allowSpan:
    | {
        toolName: string;
        serverId: string;
        agentScopes: string[];
        traceId?: string;
        pendingId?: string;
        approvalViaToken?: boolean;
      }
    | undefined;

  if (payload.method === "tools/call" && guardEnabled()) {
    const bearer = extractBearer(header(req, "authorization"));

    const result = await guard.authorize(serverId, toolName, bearer ?? "", {
      trace_id: traceId,
      session_id: sessionId,
      source: "proxy",
    });

    const decisionBase = {
      toolName,
      serverId,
      traceId,
      agentScopes: result.entry.token_scopes,
    };

    if (!result.allowed) {
      // Check for approval token bypass (from admin approval of pending request)
      let approvedViaToken = false;
      let approvalPendingId: string | undefined;
      if (result.reason?.startsWith("Missing required scope")) {
        const approvalToken = header(req, "x-approval-token");
        if (approvalToken && APPROVAL_QUEUE_ENABLED) {
          const pendingId = await validateApprovalToken(approvalToken, serverId, toolName);
          if (pendingId) {
            const pending = await getPendingRequest(pendingId);
            if (pending && pending.status === "approved") {
              guard.logger.log({
                timestamp: new Date().toISOString(),
                decision: "allow",
                server: serverId,
                tool: toolName,
                required_scope: result.required_scope,
                token_scopes: result.entry.token_scopes,
                source: "proxy",
                trace_id: traceId,
                session_id: sessionId,
                reason: `Approved via token (${pendingId})`,
              });
              approvedViaToken = true;
              approvalPendingId = pendingId;
            } else {
              recordProxyDecision({ ...decisionBase, decision: "deny" }, requestCtx);
              sendJsonRpcError(res, payload.id, "Approval token invalid or expired");
              return;
            }
          } else {
            recordProxyDecision({ ...decisionBase, decision: "deny" }, requestCtx);
            sendJsonRpcError(res, payload.id, "Approval token invalid");
            return;
          }
        } else if (APPROVAL_QUEUE_ENABLED) {
          // No approval token, create pending request
          const pending = await createPendingRequest({
            trace_id: traceId,
            session_id: sessionId,
            server_id: serverId,
            tool: toolName,
            required_scope: result.required_scope,
            token_scopes: result.entry.token_scopes,
            agent_id: header(req, "x-agent-id"),
          });

          guard.logger.log({
            timestamp: new Date().toISOString(),
            decision: "pending",
            server: serverId,
            tool: toolName,
            required_scope: result.required_scope,
            token_scopes: result.entry.token_scopes,
            source: "proxy",
            trace_id: traceId,
            session_id: sessionId,
            reason: `Awaiting approval (${pending.id})`,
          });

          recordProxyDecision({
            ...decisionBase,
            decision: "pending",
            pendingId: pending.id,
          }, requestCtx);
          const pendingPollToken = await generatePendingPollToken(pending.id);
          sendJsonRpcPending(res, payload.id, pending.id, pendingPollToken);
          return;
        }
      }
      if (!approvedViaToken) {
        recordProxyDecision({ ...decisionBase, decision: "deny" }, requestCtx);
        sendJsonRpcError(res, payload.id, result.reason ?? "Access denied");
        return;
      }
      allowSpan = {
        ...decisionBase,
        pendingId: approvalPendingId,
        approvalViaToken: true,
      };
    } else {
      allowSpan = decisionBase;
    }
  }

  const auditMcp =
    payload.method === "tools/call"
      ? {
          logger: guard.logger,
          serverId,
          toolName,
          traceId,
          sessionId,
        }
      : undefined;

  const forwardOnce = async (): Promise<void> => {
    await forwardMcpPost({
      upstreamUrl: serverCfg.url,
      reqHeaders: forwardHeaders,
      body,
      res,
      serverId,
      audit: auditMcp,
      upstreamBearer,
    });
  };

  try {
    if (allowSpan) {
      await withProxyAllowSpan(allowSpan, forwardOnce);
    } else {
      await forwardOnce();
    }
  } catch (err) {
    if (res.headersSent) return;
    const body502 = upstreamErrorBody(serverId, err);
    if (payload.method === "tools/call" && payload.id !== undefined) {
      sendJsonRpcError(
        res,
        payload.id,
        `${body502.error}: ${body502.server} — ${body502.detail}`,
      );
      return;
    }
    sendJson(res, 502, body502);
  }
}

async function main(): Promise<void> {
  const seedConfig = loadYamlConfig();
  const registry = new ServerRegistry(seedConfig);
  const seedIds = new Set(registry.serverIds());
  try {
    const kvLoaded = await loadServersFromKv(registry, seedIds);
    if (kvLoaded > 0) {
      console.info(`[MCPToolGuard proxy] loaded ${kvLoaded} server(s) from KV`);
    } else if (kvEnabled()) {
      console.info("[MCPToolGuard proxy] KV enabled — no extra servers in registry");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[MCPToolGuard proxy] KV startup load failed: ${message}`);
  }

  const jwtTrust = jwtTrustFromEnv();
  const guard = new ToolGuard({
    config: registry.toGuardConfig(),
    publicKey: readPublicKeyPem(),
    ...jwtTrust,
  });
  await guard.init();
  syncGuardConfig(guard, registry);

  // Load persisted audit entries from KV (best-effort, don't block startup)
  guard.logger.loadFromKv().then((n) => {
    if (n > 0) console.info(`[MCPToolGuard proxy] loaded ${n} audit entries from KV`);
  }).catch(() => {/* non-fatal */});

  const tokenVendor = tokenVendorFromEnv();
  const apiAudience = auth0AudienceFromEnv();

  const defaultServer = process.env.MCP_PROXY_DEFAULT_SERVER?.trim() || "flight";
  const port = Number(process.env.MCP_PROXY_PORT ?? process.env.PORT ?? DEFAULT_PORT);
  const enabled = guardEnabled();
  const controlPlaneAuth = adminAuthRequired(jwtTrust);

  if (!enabled) {
    console.warn(
      "[MCPToolGuard proxy] MCP_GUARD_ENABLED=false — tools/call not enforced. Not safe for production.",
    );
  } else if (jwtTrust.jwtIssuer) {
    console.info(
      "[MCPToolGuard proxy] Dual trust: JWKS (%s) + demo PEM",
      jwtTrust.jwksUrl,
    );
  }

  const server = createServer(async (req, res) => {
    const spanPath = (() => {
      try {
        return new URL(req.url ?? "/", "http://localhost").pathname;
      } catch {
        return req.url ?? "/";
      }
    })();

    await withHttpRequestSpan(
      { method: req.method ?? "UNKNOWN", path: spanPath },
      async () => {
        try {
      if (applyCors(req, res)) return;

      const url = new URL(req.url ?? "/", "http://localhost");
      const { pathname } = url;

      // Exempt cheap read-only polls from rate limiting — only throttle MCP tool calls and LLM
      const isExemptFromRateLimit =
        req.method === "OPTIONS" ||
        pathname === "/health" ||
        (req.method === "GET" && (pathname === "/audit" || pathname.startsWith("/pending")));
      if (!isExemptFromRateLimit) {
        const ip = clientIp(req);
        const rl = RATE_LIMIT.check(ip);
        if (!rl.allowed) {
          res.statusCode = 429;
          res.setHeader("Retry-After", String(rl.retryAfterSec ?? 60));
          sendJson(res, 429, { error: "Rate limit exceeded" });
          return;
        }
        // Distributed check — KV fixed-window complements in-memory sliding window
        if (await kvRateLimitExceeded(ip, RATE_LIMIT_MAX)) {
          res.statusCode = 429;
          res.setHeader("Retry-After", "60");
          sendJson(res, 429, { error: "Rate limit exceeded" });
          return;
        }
      }

      if (req.method === "GET" && pathname === "/health") {
        const serverConfigs = registry.serverIds().map((id) => registry.getServer(id)!);
        sendJson(res, 200, {
          service: "mcp-tool-guard-proxy",
          guard_enabled: enabled,
          jwt_trust_enabled: Boolean(jwtTrust.jwtIssuer),
          control_plane_auth: controlPlaneAuth,
          audit_agent_trusted_mode: auditAgentTrustedMode(),
          auth0_mgmt_configured: Boolean(process.env.AUTH0_MGMT_CLIENT_ID),
          kv_enabled: kvEnabled(),
          approval_queue_enabled: APPROVAL_QUEUE_ENABLED,
          gemini_configured: geminiConfigured(),
          default_server: defaultServer,
          servers: registry.serverIds(),
          upstream_auth_missing: missingUpstreamEnvNames(serverConfigs),
        });
        return;
      }

      if (req.method === "GET" && pathname === "/audit") {
        await handleAudit(guard, req, res);
        return;
      }

      if (req.method === "POST" && pathname === "/audit/agent") {
        await handleAuditAgentPost(guard, req, res);
        return;
      }

      if (req.method === "GET" && pathname === "/pending") {
        /** GET /pending — list pending requests. Auth: gateway:admin when control plane auth enabled. */
        if (
          controlPlaneAuth &&
          !(await requireGatewayAdmin(guard, req, res, sendJson))
        ) {
          return;
        }
        const statusRaw = url.searchParams.get("status") ?? undefined;
        const status =
          statusRaw === "pending" || statusRaw === "approved" || statusRaw === "denied"
            ? statusRaw
            : undefined;
        const items = await listPendingRequests(status);
        sendJson(res, 200, { pending: items });
        return;
      }

      const pendingIdMatch = pathname.match(/^\/pending\/([^/]+)\/?$/);
      if (req.method === "GET" && pendingIdMatch) {
        /**
         * GET /pending/:id — read one pending request.
         * Auth: short-lived pending poll token (x-pending-token or poll_token query), or gateway:admin when control-plane auth is enabled.
         */
        const pendingId = pendingIdMatch[1];
        const pollToken =
          header(req, "x-pending-token") ??
          url.searchParams.get("poll_token") ??
          undefined;

        let canReadPending = false;
        if (pollToken && (await validatePendingPollToken(pollToken, pendingId))) {
          canReadPending = true;
        }

        if (!canReadPending) {
          if (controlPlaneAuth) {
            if (!(await requireGatewayAdmin(guard, req, res, sendJson))) {
              return;
            }
            canReadPending = true;
          } else {
            sendJson(res, 401, {
              error:
                "Missing or invalid pending poll token (use x-pending-token from pending response)",
            });
            return;
          }
        }

        const item = await getPendingRequest(pendingId);
        if (!item) {
          sendJson(res, 404, { error: "Pending request not found" });
          return;
        }
        const response: any = { pending: item };
        if (item.status === "approved") {
          const token = await getApprovalTokenForPending(item.id);
          if (token) {
            response.approval_token = token;
          }
        }
        sendJson(res, 200, response);
        return;
      }

      const pendingApproveMatch = pathname.match(/^\/pending\/([^/]+)\/approve\/?$/);
      if (req.method === "POST" && pendingApproveMatch) {
        /** POST /pending/:id/approve — resolve a pending request as approved. Auth: gateway:admin when enabled. */
        if (
          controlPlaneAuth &&
          !(await requireGatewayAdmin(guard, req, res, sendJson))
        ) {
          return;
        }
        const body = await readJson<{ resolvedBy?: string }>(req).catch(() => ({ resolvedBy: undefined }));
        const updated = await resolvePendingRequest(
          pendingApproveMatch[1],
          "approved",
          body.resolvedBy,
        );
        if (!updated) {
          sendJson(res, 404, { error: "Pending request not found" });
          return;
        }
        const approvalToken = await generateApprovalToken(updated);
        guard.logger.log({
          timestamp: new Date().toISOString(),
          decision: "allow",
          server: updated.server_id,
          tool: updated.tool,
          required_scope: updated.required_scope,
          token_scopes: updated.token_scopes,
          source: "proxy",
          trace_id: updated.trace_id,
          session_id: updated.session_id,
          reason: `Pending request approved (${updated.id})`,
        });
        sendJson(res, 200, { pending: updated, approval_token: approvalToken });
        return;
      }

      const pendingDenyMatch = pathname.match(/^\/pending\/([^/]+)\/deny\/?$/);
      if (req.method === "POST" && pendingDenyMatch) {
        /** POST /pending/:id/deny — resolve a pending request as denied. Auth: gateway:admin when enabled. */
        if (
          controlPlaneAuth &&
          !(await requireGatewayAdmin(guard, req, res, sendJson))
        ) {
          return;
        }
        const body = await readJson<{ resolvedBy?: string }>(req).catch(() => ({ resolvedBy: undefined }));
        const updated = await resolvePendingRequest(
          pendingDenyMatch[1],
          "denied",
          body.resolvedBy,
        );
        if (!updated) {
          sendJson(res, 404, { error: "Pending request not found" });
          return;
        }
        guard.logger.log({
          timestamp: new Date().toISOString(),
          decision: "deny",
          server: updated.server_id,
          tool: updated.tool,
          required_scope: updated.required_scope,
          token_scopes: updated.token_scopes,
          source: "proxy",
          trace_id: updated.trace_id,
          session_id: updated.session_id,
          reason: `Pending request denied (${updated.id})`,
        });
        sendJson(res, 200, { pending: updated });
        return;
      }

      /** GET /servers — list registry. Auth: no. */
      if (req.method === "GET" && pathname === "/servers") {
        sendJson(res, 200, { servers: registry.list() });
        return;
      }

      /** POST /servers — add MCP server. Auth: gateway:admin when control plane auth enabled. */
      if (req.method === "POST" && pathname === "/servers") {
        if (
          controlPlaneAuth &&
          !(await requireGatewayAdmin(guard, req, res, sendJson))
        ) {
          return;
        }
        const body = await readJson<{
          id: string;
          url: string;
          scopes: Record<string, string[]>;
          upstream_token_env?: string;
        }>(
          req,
        );
        const result = registry.add(body);
        if (!result.ok) {
          sendJson(res, 400, { error: result.error });
          return;
        }
        const persisted = kvEnabled();
        if (persisted) {
          try {
            await persistServer(result.id, {
              url: body.url.trim(),
              scopes: body.scopes ?? {},
              ...(body.upstream_token_env?.trim()
                ? { upstream_token_env: body.upstream_token_env.trim() }
                : {}),
            });
          } catch (err) {
            registry.remove(result.id);
            sendJson(res, 500, {
              error: "kv_persist_failed",
              detail: err instanceof Error ? err.message : String(err),
            });
            return;
          }
        }
        syncGuardConfig(guard, registry);
        const actor = await identifyBearer(guard, req);
        guard.logger.log({
          timestamp: new Date().toISOString(),
          decision: "allow",
          server: result.id,
          tool: "__registry:add__",
          required_scope: GATEWAY_ADMIN_SCOPE,
          token_scopes: [],
          reason: persisted
            ? `MCP server registered by ${actor}`
            : `MCP server registered by ${actor} — KV disabled, NOT durable across a restart`,
          source: "proxy",
        });
        sendJson(res, 201, { ...result, persisted });
        return;
      }

      const deleteServerMatch = pathname.match(/^\/servers\/([^/]+)\/?$/);
      if (req.method === "DELETE" && deleteServerMatch) {
        /** DELETE /servers/:id — remove server. Auth: gateway:admin when enabled. */
        if (
          controlPlaneAuth &&
          !(await requireGatewayAdmin(guard, req, res, sendJson))
        ) {
          return;
        }
        const removedId = deleteServerMatch[1];
        const removed = registry.remove(removedId);
        if (!removed) {
          sendJson(res, 404, { error: "Server not found" });
          return;
        }
        await removeServerFromKv(removedId);
        syncGuardConfig(guard, registry);
        const actor = await identifyBearer(guard, req);
        guard.logger.log({
          timestamp: new Date().toISOString(),
          decision: "allow",
          server: removedId,
          tool: "__registry:remove__",
          required_scope: GATEWAY_ADMIN_SCOPE,
          token_scopes: [],
          reason: `MCP server removed by ${actor}`,
          source: "proxy",
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      const toolsMatch = pathname.match(/^\/servers\/([^/]+)\/tools\/?$/);
      if (req.method === "GET" && toolsMatch) {
        /** GET /servers/:id/tools — tools/list via proxy. Auth: no; Bearer optional. */
        const serverCfg = registry.getServer(toolsMatch[1]);
        if (!serverCfg) {
          sendJson(res, 404, { error: "Server not found" });
          return;
        }
        const missingUpstream = upstreamAuthMissing(serverCfg);
        if (missingUpstream) {
          sendJson(res, 503, {
            error: `Upstream credential not configured — set ${missingUpstream} on the proxy`,
          });
          return;
        }
        const bearer = extractBearer(header(req, "authorization")) ?? undefined;
        try {
          const tools = await discoverMcpTools(
            serverCfg.url,
            bearer,
            serverCfg.upstream_token,
          );
          sendJson(res, 200, { tools });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const statusMatch = message.match(/HTTP (\d{3})/);
          const upstreamStatus = statusMatch ? Number(statusMatch[1]) : undefined;
          sendJson(
            res,
            502,
            upstreamErrorBody(toolsMatch[1], err, upstreamStatus),
          );
        }
        return;
      }

      /** GET /agents — list persisted agents. Auth: no. */
      if (req.method === "GET" && pathname === "/agents") {
        const agents = await listAgents();
        sendJson(res, 200, { agents });
        return;
      }

      /** POST /agents — create Auth0 M2M client. Auth: gateway:admin when enabled. */
      if (req.method === "POST" && pathname === "/agents") {
        if (
          controlPlaneAuth &&
          !(await requireGatewayAdmin(guard, req, res, sendJson))
        ) {
          return;
        }
        const body = await readJson<{ name: string; scopes: string[]; serverId?: string }>(req);
        try {
          const created = await createM2mAgent(body.name, body.scopes ?? []);
          const record = buildAgentRecord({
            name: created.name,
            serverId: body.serverId?.trim() || "flight",
            scopes: body.scopes ?? [],
            auth0ClientId: created.clientId,
            auth0AppName: `mcp-agent-${created.name}`,
            clientSecretEnc: encryptClientSecret(created.clientSecret),
          });
          await saveAgent(record);
          sendJson(res, 201, { ...created, serverId: record.serverId });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 503, { error: message });
        }
        return;
      }

      const agentTokenMatch = pathname.match(/^\/agents\/([^/]+)\/token\/?$/);
      if (req.method === "POST" && agentTokenMatch) {
        /** POST /agents/:clientId/token — vend JWT using secret stored at create (gateway:admin). */
        if (!tokenVendor || !apiAudience) {
          sendJson(res, 503, { error: "AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending" });
          return;
        }
        if (
          controlPlaneAuth &&
          !(await requireGatewayAdmin(guard, req, res, sendJson))
        ) {
          return;
        }
        const clientId = agentTokenMatch[1];
        try {
          const clientSecret = await getAgentClientSecret(clientId);
          if (!clientSecret) {
            sendJson(res, 404, {
              error:
                "Agent has no stored credentials — recreate the agent (created before server-side secret storage)",
            });
            return;
          }
          const vended = await tokenVendor.vend(clientId, clientSecret, apiAudience);
          sendJson(res, 200, vended);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 503, { error: message });
        }
        return;
      }

      const deleteAgentMatch = pathname.match(/^\/agents\/([^/]+)\/?$/);
      if (req.method === "DELETE" && deleteAgentMatch) {
        /** DELETE /agents/:clientId — revoke M2M client. Auth: gateway:admin when enabled. */
        if (
          controlPlaneAuth &&
          !(await requireGatewayAdmin(guard, req, res, sendJson))
        ) {
          return;
        }
        try {
          const clientId = deleteAgentMatch[1];
          await deleteM2mAgent(clientId);
          await deleteAgent(clientId);
          tokenVendor?.invalidate(clientId);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 503, { error: message });
        }
        return;
      }

      /** POST /llm/complete — proxy Gemini completion server-side (key never exposed to browser). */
      if (req.method === "POST" && pathname === "/llm/complete") {
        if (!geminiConfigured()) {
          sendJson(res, 503, { error: "GEMINI_API_KEY not configured on gateway" });
          return;
        }
        try {
          const body = await readJson<{ messages: unknown[]; tools?: unknown[] }>(req);
          const result = await geminiComplete(body as Parameters<typeof geminiComplete>[0]);
          console.info(`[MCPToolGuard] llm/complete → ${result.toolCall ? `toolCall:${result.toolCall.name}` : "text"}`);
          sendJson(res, 200, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[MCPToolGuard] llm/complete error: ${message}`);
          sendJson(res, 502, { error: message });
        }
        return;
      }

      /** POST /token — vend client_credentials JWT. Auth: gateway:admin when enabled. */
      if (req.method === "POST" && pathname === "/token") {
        if (!tokenVendor || !apiAudience) {
          sendJson(res, 503, { error: "AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending" });
          return;
        }
        if (
          controlPlaneAuth &&
          !(await requireGatewayAdmin(guard, req, res, sendJson))
        ) {
          return;
        }
        const body = await readJson<{ clientId: string; clientSecret: string }>(req);
        try {
          const vended = await tokenVendor.vend(
            body.clientId,
            body.clientSecret,
            apiAudience,
          );
          sendJson(res, 200, vended);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 401, { error: message });
        }
        return;
      }

      if (req.method === "POST") {
        const route = matchMcpRoute(pathname, defaultServer);
        if (route) {
          await handleMcp(guard, registry, route.serverId, req, res);
          return;
        }
      }

        sendJson(res, 404, { error: "Not found" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: message });
        } else {
          res.end();
        }
      }
      },
    );
  });

  server.listen(port, () => {
    console.info(
      `[MCPToolGuard proxy] listening on :${port} — agent gateway + guard proxy${kvEnabled() ? " (KV)" : " (in-memory)"}`,
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

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
  recordProxyDecision,
  withHttpRequestSpan,
  withProxyAllowSpan,
} from "./telemetry.js";
import {
  auth0AudienceFromEnv,
  tokenVendorFromEnv,
} from "./token-vendor.js";
import { geminiComplete, geminiConfigured } from "./llm-proxy.js";
import {
  handleAuditAgentPostRoute,
  handleAuditRoute,
} from "./proxy-routes-audit.js";
import { handlePendingRoutes } from "./proxy-routes-pending.js";
import { handleServerRoutes } from "./proxy-routes-servers.js";
import {
  applyCors,
  extractBearer,
  header,
  readBody,
  readJson,
  sendJson,
  sendJsonRpcError,
  sendJsonRpcPending,
} from "./http-helpers.js";
import type { GuardConfig, ServerConfig } from "./types.js";

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
        await handleAuditRoute(guard, req, res);
        return;
      }

      if (req.method === "POST" && pathname === "/audit/agent") {
        await handleAuditAgentPostRoute(guard, req, res);
        return;
      }

      if (
        await handlePendingRoutes(
          guard,
          req,
          res,
          url,
          pathname,
          controlPlaneAuth,
          sendJson,
        )
      ) {
        return;
      }

      if (
        await handleServerRoutes({
          guard,
          registry,
          req,
          res,
          pathname,
          controlPlaneAuth,
          onRegistryChanged: () => syncGuardConfig(guard, registry),
        })
      ) {
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

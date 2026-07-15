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

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import {
  adminAuthRequired,
} from "./admin-auth.js";
import { getAgent } from "./agent-store.js";
import { missingUpstreamEnvNames, resolveGuardConfig } from "./config-resolver.js";
import { kvEnabled } from "./kv.js";
import { loadServersFromKv } from "./registry-kv.js";
import {
  auditAgentTrustedMode,
  guardEnabled,
  m2mRevocationEnabled,
  jwtTrustFromEnv,
  readPublicKeyPem,
} from "./env.js";
import { ToolGuard } from "./guard.js";
import { clientIp, kvRateLimitExceeded, SlidingWindowRateLimiter } from "./rate-limit.js";
import { ServerRegistry } from "./server-registry.js";
import {
  withHttpRequestSpan,
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
import { handleAgentsTokenRoutes } from "./proxy-routes-agents-token.js";
import { handleMcpRoute } from "./proxy-routes-mcp.js";
import {
  applyCors,
  readJson,
  sendJson,
} from "./http-helpers.js";
import type { GuardConfig } from "./types.js";

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
  const revocationEnabled = m2mRevocationEnabled();
  const guard = new ToolGuard({
    config: registry.toGuardConfig(),
    publicKey: readPublicKeyPem(),
    ...(revocationEnabled
      ? {
          isM2mClientActive: async (clientId: string) =>
            Boolean(await getAgent(clientId)),
        }
      : {}),
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
  if (!revocationEnabled) {
    console.warn(
      "[MCPToolGuard proxy] M2M immediate revocation disabled (MCP_M2M_REVOCATION=false or KV disabled)",
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
          m2m_revocation_enabled: revocationEnabled,
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

      if (
        await handleAgentsTokenRoutes({
          guard,
          req,
          res,
          pathname,
          controlPlaneAuth,
          tokenVendor,
          apiAudience,
        })
      ) {
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

      if (req.method === "POST") {
        const route = matchMcpRoute(pathname, defaultServer);
        if (route) {
          await handleMcpRoute(guard, registry, route.serverId, req, res);
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

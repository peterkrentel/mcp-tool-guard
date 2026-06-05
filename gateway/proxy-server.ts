/**
 * Guard HTTP proxy (#12) — authoritative JWT scope enforcement + audit
 * in front of upstream MCP URLs from gateway/config.yaml.
 *
 * Routes:
 *   POST /mcp              → default server (MCP_PROXY_DEFAULT_SERVER, default flight)
 *   POST /:serverId/mcp    → configured upstream
 *   GET  /audit            → proxy enforcement log (Bearer when guard enabled)
 *   GET  /health           → status + configured servers
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { ToolGuard } from "./guard.js";
import {
  corsAllowOrigins,
  guardEnabled,
  jwtTrustFromEnv,
  readPublicKeyPem,
} from "./env.js";
import type { GuardConfig } from "./types.js";

function gatewayRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return here.endsWith(`${sep}dist`) ? resolve(here, "..") : here;
}

const gatewayDir = gatewayRoot();
const DEFAULT_PORT = 8787;
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

function loadConfig(): GuardConfig {
  const configPath =
    process.env.MCP_PROXY_CONFIG?.trim() ||
    resolve(gatewayDir, "config.yaml");
  const raw = readFileSync(configPath, "utf8");
  return parseYaml(raw) as GuardConfig;
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
      "Authorization, Content-Type, Accept, X-Trace-Id, X-Session-Id",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

async function forwardPost(
  upstreamUrl: string,
  req: IncomingMessage,
  body: Buffer,
  res: ServerResponse,
): Promise<void> {
  const forwardHeaders: Record<string, string> = {
    "Content-Type": header(req, "content-type") ?? "application/json",
    Accept: header(req, "accept") ?? "application/json, text/event-stream",
  };
  const auth = header(req, "authorization");
  if (auth) forwardHeaders.Authorization = auth;
  const traceId = header(req, "x-trace-id");
  if (traceId) forwardHeaders["X-Trace-Id"] = traceId;
  const sessionId = header(req, "x-session-id");
  if (sessionId) forwardHeaders["X-Session-Id"] = sessionId;

  const upstream = await fetch(upstreamUrl, {
    method: "POST",
    headers: forwardHeaders,
    body: new Uint8Array(body),
  });

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

async function handleAudit(
  guard: ToolGuard,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? "100"), 500));
  sendJson(res, 200, { entries: entries.slice(-limit), source: "guard-proxy" });
}

async function handleMcp(
  guard: ToolGuard,
  config: GuardConfig,
  serverId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const serverCfg = config.servers[serverId];
  if (!serverCfg) {
    sendJson(res, 404, { error: `Unknown server '${serverId}'` });
    return;
  }

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
    await forwardPost(serverCfg.url, req, body, res);
    return;
  }

  if (payload.method === "tools/call" && guardEnabled()) {
    const toolName = payload.params?.name ?? "";
    const bearer = extractBearer(header(req, "authorization"));
    const traceId = header(req, "x-trace-id");
    const sessionId = header(req, "x-session-id");

    const result = await guard.authorize(serverId, toolName, bearer ?? "", {
      trace_id: traceId,
      session_id: sessionId,
    });

    if (!result.allowed) {
      sendJsonRpcError(res, payload.id, result.reason ?? "Access denied");
      return;
    }
  }

  await forwardPost(serverCfg.url, req, body, res);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const jwtTrust = jwtTrustFromEnv();
  const guard = new ToolGuard({
    config,
    publicKey: readPublicKeyPem(),
    ...jwtTrust,
  });
  await guard.init();

  const defaultServer = process.env.MCP_PROXY_DEFAULT_SERVER?.trim() || "flight";
  const port = Number(process.env.MCP_PROXY_PORT ?? DEFAULT_PORT);
  const enabled = guardEnabled();

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
    try {
      if (applyCors(req, res)) return;

      const url = new URL(req.url ?? "/", "http://localhost");
      const { pathname } = url;

      if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, {
          service: "mcp-tool-guard-proxy",
          guard_enabled: enabled,
          jwt_trust_enabled: Boolean(jwtTrust.jwtIssuer),
          default_server: defaultServer,
          servers: Object.keys(config.servers),
        });
        return;
      }

      if (req.method === "GET" && pathname === "/audit") {
        await handleAudit(guard, req, res);
        return;
      }

      if (req.method === "POST") {
        const route = matchMcpRoute(pathname, defaultServer);
        if (route) {
          await handleMcp(guard, config, route.serverId, req, res);
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
  });

  server.listen(port, () => {
    console.info(
      `[MCPToolGuard proxy] listening on :${port} — POST /mcp (→ ${defaultServer}), POST /:server/mcp, GET /audit`,
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

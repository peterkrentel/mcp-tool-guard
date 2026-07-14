import type { IncomingMessage, ServerResponse } from "node:http";

import { GATEWAY_ADMIN_SCOPE, identifyBearer, requireGatewayAdmin } from "./admin-auth.js";
import { extractBearer, header, readJson, sendJson } from "./http-helpers.js";
import { kvEnabled } from "./kv.js";
import { discoverMcpTools, upstreamErrorBody } from "./mcp-upstream.js";
import { persistServer, removeServerFromKv } from "./registry-kv.js";
import type { ToolGuard } from "./guard.js";
import type { ServerRegistry } from "./server-registry.js";
import type { ServerConfig } from "./types.js";

function upstreamAuthMissing(serverCfg: ServerConfig): string | null {
  const envName = serverCfg.upstream_token_env?.trim();
  if (!envName || serverCfg.upstream_token) return null;
  return envName;
}

interface HandleServerRoutesOptions {
  guard: ToolGuard;
  registry: ServerRegistry;
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  controlPlaneAuth: boolean;
  onRegistryChanged: () => void;
}

export async function handleServerRoutes({
  guard,
  registry,
  req,
  res,
  pathname,
  controlPlaneAuth,
  onRegistryChanged,
}: HandleServerRoutesOptions): Promise<boolean> {
  /** GET /servers — list registry. Auth: no. */
  if (req.method === "GET" && pathname === "/servers") {
    sendJson(res, 200, { servers: registry.list() });
    return true;
  }

  /** POST /servers — add MCP server. Auth: gateway:admin when control plane auth enabled. */
  if (req.method === "POST" && pathname === "/servers") {
    if (controlPlaneAuth && !(await requireGatewayAdmin(guard, req, res, sendJson))) {
      return true;
    }
    const body = await readJson<{
      id: string;
      url: string;
      scopes: Record<string, string[]>;
      upstream_token_env?: string;
    }>(req);
    const result = registry.add(body);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
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
        return true;
      }
    }
    onRegistryChanged();
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
    return true;
  }

  const deleteServerMatch = pathname.match(/^\/servers\/([^/]+)\/?$/);
  if (req.method === "DELETE" && deleteServerMatch) {
    /** DELETE /servers/:id — remove server. Auth: gateway:admin when enabled. */
    if (controlPlaneAuth && !(await requireGatewayAdmin(guard, req, res, sendJson))) {
      return true;
    }
    const removedId = deleteServerMatch[1];
    const removed = registry.remove(removedId);
    if (!removed) {
      sendJson(res, 404, { error: "Server not found" });
      return true;
    }
    await removeServerFromKv(removedId);
    onRegistryChanged();
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
    return true;
  }

  const toolsMatch = pathname.match(/^\/servers\/([^/]+)\/tools\/?$/);
  if (req.method === "GET" && toolsMatch) {
    /** GET /servers/:id/tools — tools/list via proxy. Auth: no; Bearer optional. */
    const serverCfg = registry.getServer(toolsMatch[1]);
    if (!serverCfg) {
      sendJson(res, 404, { error: "Server not found" });
      return true;
    }
    const missingUpstream = upstreamAuthMissing(serverCfg);
    if (missingUpstream) {
      sendJson(res, 503, {
        error: `Upstream credential not configured — set ${missingUpstream} on the proxy`,
      });
      return true;
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
    return true;
  }

  return false;
}
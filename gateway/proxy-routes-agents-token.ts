import type { IncomingMessage, ServerResponse } from "node:http";

import { encryptClientSecret } from "./agent-secrets.js";
import {
  buildAgentRecord,
  deleteAgent,
  getAgentClientSecret,
  listAgents,
  saveAgent,
} from "./agent-store.js";
import { requireGatewayAdmin } from "./admin-auth.js";
import { createM2mAgent, deleteM2mAgent } from "./auth0-mgmt.js";
import type { ToolGuard } from "./guard.js";
import { readJson, sendJson } from "./http-helpers.js";
import type { TokenVendor } from "./token-vendor.js";

export interface HandleAgentsTokenRoutesOptions {
  guard: ToolGuard;
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  controlPlaneAuth: boolean;
  tokenVendor: TokenVendor | null;
  apiAudience: string | null;
}

/**
 * Handle control-plane routes:
 * - GET /agents
 * - POST /agents
 * - DELETE /agents/:clientId
 * - POST /agents/:clientId/token
 * - POST /token
 */
export async function handleAgentsTokenRoutes(
  options: HandleAgentsTokenRoutesOptions,
): Promise<boolean> {
  const {
    guard,
    req,
    res,
    pathname,
    controlPlaneAuth,
    tokenVendor,
    apiAudience,
  } = options;

  /** GET /agents — list persisted agents. Auth: no. */
  if (req.method === "GET" && pathname === "/agents") {
    const agents = await listAgents();
    sendJson(res, 200, { agents });
    return true;
  }

  /** POST /agents — create Auth0 M2M client. Auth: gateway:admin when enabled. */
  if (req.method === "POST" && pathname === "/agents") {
    if (
      controlPlaneAuth &&
      !(await requireGatewayAdmin(guard, req, res, sendJson))
    ) {
      return true;
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
    return true;
  }

  const agentTokenMatch = pathname.match(/^\/agents\/([^/]+)\/token\/?$/);
  if (req.method === "POST" && agentTokenMatch) {
    /** POST /agents/:clientId/token — vend JWT using secret stored at create (gateway:admin). */
    if (!tokenVendor || !apiAudience) {
      sendJson(res, 503, { error: "AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending" });
      return true;
    }
    if (
      controlPlaneAuth &&
      !(await requireGatewayAdmin(guard, req, res, sendJson))
    ) {
      return true;
    }
    const clientId = agentTokenMatch[1];
    try {
      const clientSecret = await getAgentClientSecret(clientId);
      if (!clientSecret) {
        sendJson(res, 404, {
          error:
            "Agent has no stored credentials — recreate the agent (created before server-side secret storage)",
        });
        return true;
      }
      const vended = await tokenVendor.vend(clientId, clientSecret, apiAudience);
      sendJson(res, 200, vended);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 503, { error: message });
    }
    return true;
  }

  const deleteAgentMatch = pathname.match(/^\/agents\/([^/]+)\/?$/);
  if (req.method === "DELETE" && deleteAgentMatch) {
    /** DELETE /agents/:clientId — revoke M2M client. Auth: gateway:admin when enabled. */
    if (
      controlPlaneAuth &&
      !(await requireGatewayAdmin(guard, req, res, sendJson))
    ) {
      return true;
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
    return true;
  }

  /** POST /token — vend client_credentials JWT. Auth: gateway:admin when enabled. */
  if (req.method === "POST" && pathname === "/token") {
    if (!tokenVendor || !apiAudience) {
      sendJson(res, 503, { error: "AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending" });
      return true;
    }
    if (
      controlPlaneAuth &&
      !(await requireGatewayAdmin(guard, req, res, sendJson))
    ) {
      return true;
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
    return true;
  }

  return false;
}
import type { IncomingMessage, ServerResponse } from "node:http";

import { encryptClientSecret } from "./agent-secrets.js";
import {
  buildAgentRecord,
  deleteAgent,
  getAgentClientSecret,
  listAgents,
  saveAgent,
} from "./agent-store.js";
import { GATEWAY_ADMIN_SCOPE, requireGatewayAdmin } from "./admin-auth.js";
import type { ToolGuard } from "./guard.js";
import type { IdpAdapter } from "./idp-adapter.js";
import { readJson, sendJson } from "./http-helpers.js";
import {
  createPendingAgent,
  getAndConsumePendingAgent,
  markPendingAgentActive,
  markPendingAgentFailed,
} from "./pending-agent-store.js";

export interface HandleAgentsTokenRoutesOptions {
  guard: ToolGuard;
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  controlPlaneAuth: boolean;
  idpAdapter: IdpAdapter;
}

/**
 * Handle control-plane routes:
 * - GET /agents
 * - POST /agents
 * - GET /agents/pending/:id
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
    idpAdapter,
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
    if ((body.scopes ?? []).includes(GATEWAY_ADMIN_SCOPE)) {
      sendJson(res, 400, {
        error: `M2M agents cannot be granted ${GATEWAY_ADMIN_SCOPE} — it is a human-operator-only control-plane permission`,
      });
      return true;
    }

    // Entra's createAgent() can take 30+ seconds worst-case (Graph
    // eventual-consistency retries in entra-mgmt.ts). Return immediately
    // with a pendingId and finish creation in the background so the HTTP
    // request the browser is waiting on doesn't block for that long — the
    // UI polls GET /agents/pending/:id until it's "active" or "failed".
    const serverId = body.serverId?.trim() || "flight";
    const scopes = body.scopes ?? [];
    const pendingId = createPendingAgent({
      name: body.name,
      serverId,
      scopes,
      provider: idpAdapter.providerId,
    });
    sendJson(res, 202, { pendingId, status: "pending" });

    void (async () => {
      try {
        const created = await idpAdapter.createAgent(body.name, scopes);
        const record = buildAgentRecord({
          name: created.name,
          serverId,
          scopes,
          auth0ClientId: created.clientId,
          auth0AppName: `mcp-agent-${created.name}`,
          provider: idpAdapter.providerId,
          clientSecretEnc: encryptClientSecret(created.clientSecret),
        });
        await saveAgent(record);
        markPendingAgentActive(pendingId, created.clientId, created.clientSecret);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        markPendingAgentFailed(pendingId, message);
      }
    })().catch((err) => {
      // Last-resort guard: nothing above should throw synchronously into
      // this catch (both branches of the try/catch handle their own
      // errors), but never let a bug here take down the process.
      console.error("[MCPToolGuard proxy] unexpected error in background agent creation:", err);
    });

    return true;
  }

  /** GET /agents/pending/:id — poll background agent-creation status. Auth: no (unguessable id, matches GET /agents' no-auth stance). */
  const pendingAgentMatch = pathname.match(/^\/agents\/pending\/([^/]+)\/?$/);
  if (req.method === "GET" && pendingAgentMatch) {
    const id = pendingAgentMatch[1];
    const entry = getAndConsumePendingAgent(id);
    if (!entry) {
      sendJson(res, 404, { error: `No pending agent creation found for id ${id}` });
      return true;
    }
    sendJson(res, 200, entry);
    return true;
  }

  const agentTokenMatch = pathname.match(/^\/agents\/([^/]+)\/token\/?$/);
  if (req.method === "POST" && agentTokenMatch) {
    /** POST /agents/:clientId/token — vend JWT using secret stored at create (gateway:admin). */
    if (!idpAdapter.isVendingConfigured()) {
      sendJson(res, 503, { error: idpAdapter.vendingConfigError() });
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
      const vended = await idpAdapter.vendToken(clientId, clientSecret);
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
      await idpAdapter.deleteAgent(clientId);
      await deleteAgent(clientId);
      idpAdapter.invalidateToken(clientId);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 503, { error: message });
    }
    return true;
  }

  /** POST /token — vend client_credentials JWT. Auth: gateway:admin when enabled. */
  if (req.method === "POST" && pathname === "/token") {
    if (!idpAdapter.isVendingConfigured()) {
      sendJson(res, 503, { error: idpAdapter.vendingConfigError() });
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
      const vended = await idpAdapter.vendToken(body.clientId, body.clientSecret);
      sendJson(res, 200, vended);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 401, { error: message });
    }
    return true;
  }

  return false;
}
import type { IncomingMessage, ServerResponse } from "node:http";

import { requireGatewayAdmin } from "./admin-auth.js";
import { header, readJson, sendJson } from "./http-helpers.js";
import {
  generateApprovalToken,
  getApprovalTokenForPending,
  getPendingRequest,
  listPendingRequests,
  resolvePendingRequest,
  validatePendingPollToken,
} from "./pending-store.js";
import type { ToolGuard } from "./guard.js";

type SendJsonFn = (res: ServerResponse, status: number, body: unknown) => void;

export async function handlePendingRoutes(
  guard: ToolGuard,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  pathname: string,
  controlPlaneAuth: boolean,
  sendJsonFn: SendJsonFn,
): Promise<boolean> {
  /** GET /pending — list pending requests. Auth: gateway:admin when control plane auth enabled. */
  if (req.method === "GET" && pathname === "/pending") {
    if (controlPlaneAuth && !(await requireGatewayAdmin(guard, req, res, sendJsonFn))) {
      return true;
    }
    const statusRaw = url.searchParams.get("status") ?? undefined;
    const status =
      statusRaw === "pending" || statusRaw === "approved" || statusRaw === "denied"
        ? statusRaw
        : undefined;
    const items = await listPendingRequests(status);
    sendJson(res, 200, { pending: items });
    return true;
  }

  const pendingIdMatch = pathname.match(/^\/pending\/([^/]+)\/?$/);
  if (req.method === "GET" && pendingIdMatch) {
    /**
     * GET /pending/:id — read one pending request.
     * Auth: short-lived pending poll token (x-pending-token or poll_token query), or gateway:admin when control-plane auth is enabled.
     */
    const pendingId = pendingIdMatch[1];
    const pollToken =
      header(req, "x-pending-token") ?? url.searchParams.get("poll_token") ?? undefined;

    let canReadPending = false;
    if (pollToken && (await validatePendingPollToken(pollToken, pendingId))) {
      canReadPending = true;
    }

    if (!canReadPending) {
      if (controlPlaneAuth) {
        if (!(await requireGatewayAdmin(guard, req, res, sendJsonFn))) {
          return true;
        }
        canReadPending = true;
      } else {
        sendJson(res, 401, {
          error:
            "Missing or invalid pending poll token (use x-pending-token from pending response)",
        });
        return true;
      }
    }

    const item = await getPendingRequest(pendingId);
    if (!item) {
      sendJson(res, 404, { error: "Pending request not found" });
      return true;
    }
    const response: any = { pending: item };
    if (item.status === "approved") {
      const token = await getApprovalTokenForPending(item.id);
      if (token) {
        response.approval_token = token;
      }
    }
    sendJson(res, 200, response);
    return true;
  }

  const pendingApproveMatch = pathname.match(/^\/pending\/([^/]+)\/approve\/?$/);
  if (req.method === "POST" && pendingApproveMatch) {
    /** POST /pending/:id/approve — resolve a pending request as approved. Auth: gateway:admin when enabled. */
    if (controlPlaneAuth && !(await requireGatewayAdmin(guard, req, res, sendJsonFn))) {
      return true;
    }
    const body = await readJson<{ resolvedBy?: string }>(req).catch(() => ({ resolvedBy: undefined }));
    const updated = await resolvePendingRequest(
      pendingApproveMatch[1],
      "approved",
      body.resolvedBy,
    );
    if (!updated) {
      sendJson(res, 404, { error: "Pending request not found" });
      return true;
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
    return true;
  }

  const pendingDenyMatch = pathname.match(/^\/pending\/([^/]+)\/deny\/?$/);
  if (req.method === "POST" && pendingDenyMatch) {
    /** POST /pending/:id/deny — resolve a pending request as denied. Auth: gateway:admin when enabled. */
    if (controlPlaneAuth && !(await requireGatewayAdmin(guard, req, res, sendJsonFn))) {
      return true;
    }
    const body = await readJson<{ resolvedBy?: string }>(req).catch(() => ({ resolvedBy: undefined }));
    const updated = await resolvePendingRequest(
      pendingDenyMatch[1],
      "denied",
      body.resolvedBy,
    );
    if (!updated) {
      sendJson(res, 404, { error: "Pending request not found" });
      return true;
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
    return true;
  }

  return false;
}

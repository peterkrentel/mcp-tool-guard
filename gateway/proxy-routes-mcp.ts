import { context } from "@opentelemetry/api";
import type { IncomingMessage, ServerResponse } from "node:http";

import { guardEnabled, pendingLongPollMaxMs } from "./env.js";
import type { ToolGuard } from "./guard.js";
import {
  extractBearer,
  header,
  readBody,
  sendJson,
  sendJsonRpcError,
  sendJsonRpcPending,
} from "./http-helpers.js";
import { forwardMcpPost, upstreamErrorBody } from "./mcp-upstream.js";
import {
  createPendingRequest,
  generatePendingPollToken,
  getPendingRequest,
  validateApprovalToken,
  waitForPendingResolution,
} from "./pending-store.js";
import type { ServerRegistry } from "./server-registry.js";
import { recordProxyDecision, withProxyAllowSpan } from "./telemetry.js";
import type { ServerConfig } from "./types.js";

const APPROVAL_QUEUE_ENABLED =
  process.env.MCP_APPROVAL_QUEUE?.trim().toLowerCase() === "true";

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

export async function handleMcpRoute(
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
        approvalViaLongPoll?: boolean;
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
      let approved = false;
      let approvalPendingId: string | undefined;
      let approvalViaToken = false;
      let approvalViaLongPoll = false;

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
              approved = true;
              approvalViaToken = true;
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
          const waitForApproval =
            header(req, "x-wait-for-approval")?.trim().toLowerCase() === "true";

          const pending = await createPendingRequest({
            trace_id: traceId,
            session_id: sessionId,
            server_id: serverId,
            tool: toolName,
            required_scope: result.required_scope,
            token_scopes: result.entry.token_scopes,
            agent_id: header(req, "x-agent-id"),
            wait_for_approval: waitForApproval,
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

          recordProxyDecision(
            {
              ...decisionBase,
              decision: "pending",
              pendingId: pending.id,
            },
            requestCtx,
          );

          if (!waitForApproval) {
            const pendingPollToken = await generatePendingPollToken(pending.id);
            sendJsonRpcPending(res, payload.id, pending.id, pendingPollToken);
            return;
          }

          const resolved = await waitForPendingResolution(pending.id, pendingLongPollMaxMs());
          if (resolved?.status === "approved") {
            approved = true;
            approvalViaLongPoll = true;
            approvalPendingId = pending.id;
          } else {
            const reason =
              resolved?.status === "denied"
                ? `Pending request denied (${pending.id})`
                : `Approval wait timed out (${pending.id})`;
            recordProxyDecision({ ...decisionBase, decision: "deny" }, requestCtx);
            sendJsonRpcError(
              res,
              payload.id,
              reason,
              resolved?.status === "denied" ? 403 : 504,
            );
            return;
          }
        }
      }
      if (!approved) {
        recordProxyDecision({ ...decisionBase, decision: "deny" }, requestCtx);
        sendJsonRpcError(res, payload.id, result.reason ?? "Access denied");
        return;
      }
      allowSpan = {
        ...decisionBase,
        pendingId: approvalPendingId,
        approvalViaToken,
        approvalViaLongPoll,
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
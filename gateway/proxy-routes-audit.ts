import { context } from "@opentelemetry/api";
import type { IncomingMessage, ServerResponse } from "node:http";

import { GATEWAY_ADMIN_SCOPE } from "./admin-auth.js";
import { auditAgentTrustedMode, guardEnabled } from "./env.js";
import { extractBearer, header, readJson, sendJson } from "./http-helpers.js";
import { recordAgentIntent } from "./telemetry.js";
import type { ToolGuard } from "./guard.js";
import type { AuditLogEntry } from "./types.js";

/** GET /audit — returns agent, proxy, and mcp entries. Auth: Bearer when guard enabled. */
export async function handleAuditRoute(
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
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? "200"), 500));
  sendJson(res, 200, {
    entries: entries.slice(-limit),
    sources: ["agent", "proxy", "mcp"],
  });
}

/**
 * POST /audit/agent — append agent-layer intent entries.
 * Auth: Bearer with `audit:write` or `gateway:admin`, unless explicit trusted demo mode is enabled.
 */
export async function handleAuditAgentPostRoute(
  guard: ToolGuard,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
    recordAgentIntent(
      {
        toolName: entry.tool,
        decision: entry.decision,
        traceId: entry.trace_id,
      },
      requestCtx,
    );
  }
  sendJson(res, 200, { ok: true, count: items.length });
}
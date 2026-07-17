import type { IncomingMessage, ServerResponse } from "node:http";

import { guardEnabled } from "./env.js";
import type { ToolGuard } from "./guard.js";

export const GATEWAY_ADMIN_SCOPE = "gateway:admin";

export interface JwtTrustConfig {
  jwtIssuer?: string;
  jwtAudience?: string;
  jwksUrl?: string;
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

/** Control-plane auth is required when guard is on and IdP JWKS trust is configured. */
export function adminAuthRequired(jwtTrust: JwtTrustConfig): boolean {
  if (!guardEnabled()) return false;
  if (process.env.MCP_GATEWAY_ADMIN_AUTH?.toLowerCase() === "false") return false;
  return Boolean(jwtTrust.jwtIssuer && jwtTrust.jwtAudience);
}

export function hasGatewayAdminScope(guard: ToolGuard, scopes: string[]): boolean {
  return guard.jwtValidator.hasScope(scopes, GATEWAY_ADMIN_SCOPE);
}

/** Best-effort caller identity for audit entries — never throws. */
export async function identifyBearer(guard: ToolGuard, req: IncomingMessage): Promise<string> {
  const bearer = extractBearer(header(req, "authorization"));
  if (!bearer) return "anonymous";
  try {
    const { payload } = await guard.jwtValidator.validateToken(bearer);
    return typeof payload.sub === "string" ? payload.sub : "unknown";
  } catch {
    return "unknown";
  }
}

export type SendJson = (res: ServerResponse, status: number, body: unknown) => void;

/**
 * Verify Bearer JWT and `gateway:admin` permission.
 * Returns true when the request may proceed; sends 401/403 and returns false otherwise.
 */
export async function requireGatewayAdmin(
  guard: ToolGuard,
  req: IncomingMessage,
  res: ServerResponse,
  sendJson: SendJson,
): Promise<boolean> {
  const bearer = extractBearer(header(req, "authorization"));
  if (!bearer) {
    sendJson(res, 401, { error: "Missing Authorization: Bearer (gateway:admin required)" });
    return false;
  }

  try {
    const { scopes } = await guard.jwtValidator.validateToken(bearer);
    if (!hasGatewayAdminScope(guard, scopes)) {
      sendJson(res, 403, {
        error: `Missing required permission '${GATEWAY_ADMIN_SCOPE}'`,
      });
      return false;
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 401, { error: `JWT validation failed: ${message}` });
    return false;
  }
}

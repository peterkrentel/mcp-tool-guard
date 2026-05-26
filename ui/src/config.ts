/** Resolved MCP endpoint — local Vite proxy or remote flight server. */
export function resolveMcpUrl(): string {
  const fromEnv = import.meta.env.VITE_MCP_URL;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim().replace(/\/$/, "");
  }
  return "/mcp";
}

/** Optional server audit log URL (flight /audit when MCP is remote). */
export function resolveAuditUrl(mcpUrl: string): string | null {
  if (mcpUrl.startsWith("/")) {
    return null;
  }
  try {
    const base = new URL(mcpUrl);
    return `${base.origin}/audit`;
  } catch {
    return null;
  }
}

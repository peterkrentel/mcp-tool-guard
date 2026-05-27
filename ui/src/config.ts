/** Resolved MCP endpoint — local Vite proxy or remote flight server. */
export function resolveMcpUrl(): string {
  const fromEnv = import.meta.env.VITE_MCP_URL;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim().replace(/\/$/, "");
  }
  return "/mcp";
}

/** Server audit log URL — Vite proxy /audit locally, or flight origin when remote. */
export function resolveAuditUrl(mcpUrl: string): string {
  if (mcpUrl.startsWith("/")) {
    return mcpUrl.replace(/\/?mcp\/?$/, "") + "/audit";
  }
  try {
    const base = new URL(mcpUrl);
    return `${base.origin}/audit`;
  } catch {
    return "/audit";
  }
}

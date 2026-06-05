import type { GuardConfig } from "@mcp-tool-guard/gateway";

import { GUARD_CONFIG } from "./guard-config.js";

/** Owned MCP servers wired in the demo UI (not vendor stubs). */
export const DEMO_SERVER_IDS = ["flight", "documents"] as const;

export type DemoServerId = (typeof DEMO_SERVER_IDS)[number];

const BROWSER_MCP_PATHS: Record<DemoServerId, string> = {
  flight: "/mcp",
  documents: "/documents/mcp",
};

const BROWSER_AUDIT_PATHS: Record<DemoServerId, string> = {
  flight: "/audit",
  documents: "/documents/audit",
};

export function resolveServerForTool(tool: string, config: GuardConfig = GUARD_CONFIG): string | null {
  for (const [serverId, server] of Object.entries(config.servers ?? {})) {
    if (server.tools?.[tool]) return serverId;
  }
  return null;
}

export function resolveMcpUrlForServer(serverId: DemoServerId): string {
  const fromEnv = import.meta.env.VITE_MCP_URL;
  if (serverId === "flight" && fromEnv && fromEnv.trim()) {
    return fromEnv.trim().replace(/\/$/, "");
  }
  const docsEnv = import.meta.env.VITE_DOCUMENTS_MCP_URL;
  if (serverId === "documents" && docsEnv && docsEnv.trim()) {
    return docsEnv.trim().replace(/\/$/, "");
  }
  return BROWSER_MCP_PATHS[serverId];
}

export function resolveAuditUrlForServer(serverId: DemoServerId): string {
  const mcpUrl = resolveMcpUrlForServer(serverId);
  if (mcpUrl.startsWith("/")) {
    return BROWSER_AUDIT_PATHS[serverId];
  }
  try {
    const base = new URL(mcpUrl);
    return `${base.origin}/audit`;
  } catch {
    return BROWSER_AUDIT_PATHS[serverId];
  }
}

import type { AuditLogEntry } from "@mcp-tool-guard/gateway";

import { resolveProxyBase } from "./config.js";

export interface RegisteredServer {
  id: string;
  url: string;
  scopes: Record<string, string[]>;
}

export interface CreatedAgent {
  clientId: string;
  clientSecret: string;
  name: string;
}

export interface VendedToken {
  token: string;
  expiresIn: number;
}

type AdminTokenProvider = () => Promise<string | null>;

let adminTokenProvider: AdminTokenProvider | null = null;

/** SPA user token for control-plane routes (gateway:admin). */
export function setAdminTokenProvider(provider: AdminTokenProvider): void {
  adminTokenProvider = provider;
}

async function adminAuthHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  if (adminTokenProvider) {
    const token = await adminTokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function proxyFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = resolveProxyBase().replace(/\/$/, "");
  return fetch(`${base}${path}`, init);
}

export async function listServers(): Promise<RegisteredServer[]> {
  const res = await proxyFetch("/servers");
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { servers: RegisteredServer[] };
  return data.servers;
}

export async function addServer(input: {
  id: string;
  url: string;
  scopes: Record<string, string[]>;
}): Promise<void> {
  const res = await proxyFetch("/servers", {
    method: "POST",
    headers: await adminAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
}

export async function removeServer(id: string): Promise<void> {
  const res = await proxyFetch(`/servers/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await adminAuthHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function discoverTools(
  serverId: string,
  bearer?: string,
): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
  const res = await proxyFetch(`/servers/${encodeURIComponent(serverId)}/tools`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
  const data = (await res.json()) as { tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
  return data.tools;
}

export async function createAgent(name: string, scopes: string[]): Promise<CreatedAgent> {
  const res = await proxyFetch("/agents", {
    method: "POST",
    headers: await adminAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name, scopes }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
  return (await res.json()) as CreatedAgent;
}

export async function revokeAgent(clientId: string): Promise<void> {
  const res = await proxyFetch(`/agents/${encodeURIComponent(clientId)}`, {
    method: "DELETE",
    headers: await adminAuthHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
}

export async function vendToken(clientId: string, clientSecret: string): Promise<VendedToken> {
  const res = await proxyFetch("/token", {
    method: "POST",
    headers: await adminAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
  return (await res.json()) as VendedToken;
}

export async function fetchGatewayAudit(
  bearer: string,
  sessionId?: string,
): Promise<AuditLogEntry[]> {
  const base = resolveProxyBase().replace(/\/$/, "");
  const url = sessionId
    ? `${base}/audit?session_id=${encodeURIComponent(sessionId)}`
    : `${base}/audit`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { entries?: AuditLogEntry[] };
  return data.entries ?? [];
}

export async function postAgentAudit(entries: AuditLogEntry[]): Promise<void> {
  await proxyFetch("/audit/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
}

export function mcpUrlForServer(serverId: string): string {
  const base = resolveProxyBase().replace(/\/$/, "");
  return `${base}/${encodeURIComponent(serverId)}/mcp`;
}

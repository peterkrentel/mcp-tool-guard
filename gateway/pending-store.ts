import { kvGet, kvScan, kvSet } from "./kv.js";

export type PendingStatus = "pending" | "approved" | "denied";

export interface PendingRequest {
  id: string;
  trace_id?: string;
  session_id?: string;
  server_id: string;
  tool: string;
  required_scope: string;
  token_scopes: string[];
  agent_id?: string;
  requested_at: string;
  status: PendingStatus;
  resolved_at?: string;
  resolved_by?: string;
}

interface CreatePendingInput {
  trace_id?: string;
  session_id?: string;
  server_id: string;
  tool: string;
  required_scope: string;
  token_scopes: string[];
  agent_id?: string;
}

const PENDING_PREFIX = "gateway:pending:";
const PENDING_INDEX_KEY = "gateway:pending:index";

function pendingKey(id: string): string {
  return `${PENDING_PREFIX}${id}`;
}

function newPendingId(): string {
  const short = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`).replace(/-/g, "").slice(0, 12);
  return `pr_${short}`;
}

async function addToPendingIndex(id: string): Promise<void> {
  const current = (await kvGet<string[]>(PENDING_INDEX_KEY)) ?? [];
  if (!current.includes(id)) {
    current.push(id);
    await kvSet(PENDING_INDEX_KEY, current);
  }
}

export async function createPendingRequest(input: CreatePendingInput): Promise<PendingRequest> {
  const pending: PendingRequest = {
    id: newPendingId(),
    trace_id: input.trace_id,
    session_id: input.session_id,
    server_id: input.server_id,
    tool: input.tool,
    required_scope: input.required_scope,
    token_scopes: input.token_scopes,
    agent_id: input.agent_id,
    requested_at: new Date().toISOString(),
    status: "pending",
  };

  await kvSet(pendingKey(pending.id), pending);
  await addToPendingIndex(pending.id);
  return pending;
}

export async function getPendingRequest(id: string): Promise<PendingRequest | null> {
  return kvGet<PendingRequest>(pendingKey(id));
}

export async function listPendingRequests(status?: PendingStatus): Promise<PendingRequest[]> {
  const keys = await kvScan(`${PENDING_PREFIX}*`);
  const entries: PendingRequest[] = [];

  for (const key of keys) {
    const suffix = key.slice(PENDING_PREFIX.length);
    if (!suffix || suffix === "index") continue;
    const record = await kvGet<PendingRequest>(key);
    if (!record) continue;
    if (status && record.status !== status) continue;
    entries.push(record);
  }

  entries.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  return entries;
}

export async function resolvePendingRequest(
  id: string,
  status: Extract<PendingStatus, "approved" | "denied">,
  resolvedBy?: string,
): Promise<PendingRequest | null> {
  const current = await getPendingRequest(id);
  if (!current) return null;
  // Guard against double-resolve — idempotent only if same outcome
  if (current.status !== "pending") {
    return current.status === status ? current : null;
  }
  const updated: PendingRequest = {
    ...current,
    status,
    resolved_at: new Date().toISOString(),
    resolved_by: resolvedBy,
  };
  await kvSet(pendingKey(id), updated);
  return updated;
}

const APPROVAL_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const APPROVAL_TOKEN_PREFIX = "gateway:approval-token:";
const PENDING_APPROVAL_TOKEN_PREFIX = "gateway:pending:approval-token:";

interface ApprovalTokenRecord {
  pendingId: string;
  serverId: string;
  tool: string;
  expiresAt: number;
}

/** Generate a short-lived approval token bound to the specific pending request, server, and tool. */
export async function generateApprovalToken(pending: PendingRequest): Promise<string> {
  const tokenId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`).replace(/-/g, "").slice(0, 12);
  const token = `at_${tokenId}`;
  const record: ApprovalTokenRecord = {
    pendingId: pending.id,
    serverId: pending.server_id,
    tool: pending.tool,
    expiresAt: Date.now() + APPROVAL_TOKEN_TTL_MS,
  };
  await kvSet(`${APPROVAL_TOKEN_PREFIX}${token}`, record);
  await kvSet(`${PENDING_APPROVAL_TOKEN_PREFIX}${pending.id}`, token);
  return token;
}

/**
 * Validate an approval token for a specific server+tool.
 * Returns the pending request ID on success, null if invalid/expired/wrong target.
 */
export async function validateApprovalToken(
  token: string,
  serverId: string,
  tool: string,
): Promise<string | null> {
  if (!token.startsWith("at_")) return null;
  const record = await kvGet<ApprovalTokenRecord>(`${APPROVAL_TOKEN_PREFIX}${token}`);
  if (!record) return null;
  if (Date.now() > record.expiresAt) return null;
  if (record.serverId !== serverId || record.tool !== tool) return null;
  return record.pendingId;
}

/** Get the approval token for a pending request (if approved). */
export async function getApprovalTokenForPending(pendingId: string): Promise<string | null> {
  const key = `${PENDING_APPROVAL_TOKEN_PREFIX}${pendingId}`;
  return kvGet<string>(key);
}

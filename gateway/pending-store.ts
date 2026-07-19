import { kvDel, kvEnabled, kvGet, kvScan, kvSet } from "./kv.js";

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
  wait_for_approval?: boolean;
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
  wait_for_approval?: boolean;
}

// In-memory fallback when KV is not configured (local dev)
const memPending = new Map<string, PendingRequest>();
const memApprovalTokens = new Map<string, { pendingId: string; serverId: string; tool: string; expiresAt: number }>();
const memPendingTokens = new Map<string, string>(); // pendingId -> token
const memPollTokens = new Map<string, { pendingId: string; expiresAt: number }>();

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
    wait_for_approval: input.wait_for_approval,
    requested_at: new Date().toISOString(),
    status: "pending",
  };

  if (kvEnabled()) {
    await kvSet(pendingKey(pending.id), pending);
    await addToPendingIndex(pending.id);
  } else {
    memPending.set(pending.id, pending);
  }
  return pending;
}

export async function getPendingRequest(id: string): Promise<PendingRequest | null> {
  if (!kvEnabled()) return memPending.get(id) ?? null;
  return kvGet<PendingRequest>(pendingKey(id));
}

export async function listPendingRequests(status?: PendingStatus): Promise<PendingRequest[]> {
  let entries: PendingRequest[];

  if (!kvEnabled()) {
    entries = Array.from(memPending.values());
  } else {
    const keys = await kvScan(`${PENDING_PREFIX}*`);
    entries = [];
    for (const key of keys) {
      const suffix = key.slice(PENDING_PREFIX.length);
      if (!suffix || suffix === "index") continue;
      const record = await kvGet<PendingRequest>(key);
      if (!record) continue;
      entries.push(record);
    }
  }

  if (status) entries = entries.filter((e) => e.status === status);
  entries.sort((a, b) => (b.requested_at ?? "").localeCompare(a.requested_at ?? ""));
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
  if (kvEnabled()) {
    await kvSet(pendingKey(id), updated);
  } else {
    memPending.set(id, updated);
  }
  return updated;
}

/**
 * Poll a pending request until it resolves (approved/denied) or maxWaitMs elapses.
 * Detects resolution promptly (bounded by pollIntervalMs), not just at maxWaitMs.
 * Returns the latest known record — still "pending" if it timed out — or null if
 * the id was never found.
 */
export async function waitForPendingResolution(
  id: string,
  maxWaitMs: number,
  pollIntervalMs = 750,
): Promise<PendingRequest | null> {
  const deadline = Date.now() + maxWaitMs;
  let current = await getPendingRequest(id);
  while (current && current.status === "pending" && Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
    current = await getPendingRequest(id);
  }
  return current;
}

const APPROVAL_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const APPROVAL_TOKEN_PREFIX = "gateway:approval-token:";
const PENDING_APPROVAL_TOKEN_PREFIX = "gateway:pending:approval-token:";
const POLL_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PENDING_POLL_TOKEN_PREFIX = "gateway:pending:poll-token:";
const POLL_TOKEN_INDEX_PREFIX = "gateway:poll-token:";

interface ApprovalTokenRecord {
  pendingId: string;
  serverId: string;
  tool: string;
  expiresAt: number;
}

interface PollTokenRecord {
  pendingId: string;
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
  if (kvEnabled()) {
    await kvSet(`${APPROVAL_TOKEN_PREFIX}${token}`, record);
    await kvSet(`${PENDING_APPROVAL_TOKEN_PREFIX}${pending.id}`, token);
  } else {
    memApprovalTokens.set(token, record);
    memPendingTokens.set(pending.id, token);
  }
  return token;
}

/**
 * Validate an approval token for a specific server+tool and burn it (one-time use).
 * Returns the pending request ID on success, null if invalid/expired/wrong target.
 */
export async function validateApprovalToken(
  token: string,
  serverId: string,
  tool: string,
): Promise<string | null> {
  if (!token.startsWith("at_")) return null;
  if (!kvEnabled()) {
    const record = memApprovalTokens.get(token);
    if (!record) return null;
    if (Date.now() > record.expiresAt) return null;
    if (record.serverId !== serverId || record.tool !== tool) return null;
    memApprovalTokens.delete(token); // burn on use
    return record.pendingId;
  }
  const key = `${APPROVAL_TOKEN_PREFIX}${token}`;
  const record = await kvGet<ApprovalTokenRecord>(key);
  if (!record) return null;
  if (Date.now() > record.expiresAt) return null;
  if (record.serverId !== serverId || record.tool !== tool) return null;
  // Burn on first use — token cannot be reused
  await kvDel(key);
  return record.pendingId;
}

/** Get the approval token for a pending request (if approved). */
export async function getApprovalTokenForPending(pendingId: string): Promise<string | null> {
  if (!kvEnabled()) return memPendingTokens.get(pendingId) ?? null;
  const key = `${PENDING_APPROVAL_TOKEN_PREFIX}${pendingId}`;
  return kvGet<string>(key);
}

/** Generate a short-lived poll token bound to a specific pending request id. */
export async function generatePendingPollToken(pendingId: string): Promise<string> {
  const tokenId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`).replace(/-/g, "").slice(0, 12);
  const token = `pt_${tokenId}`;
  const record: PollTokenRecord = {
    pendingId,
    expiresAt: Date.now() + POLL_TOKEN_TTL_MS,
  };
  if (kvEnabled()) {
    await kvSet(`${POLL_TOKEN_INDEX_PREFIX}${token}`, record, Math.ceil(POLL_TOKEN_TTL_MS / 1000));
    await kvSet(`${PENDING_POLL_TOKEN_PREFIX}${pendingId}`, token, Math.ceil(POLL_TOKEN_TTL_MS / 1000));
  } else {
    memPollTokens.set(token, record);
  }
  return token;
}

/** Validate a pending poll token for a specific pending request id. */
export async function validatePendingPollToken(
  token: string,
  pendingId: string,
): Promise<boolean> {
  if (!token.startsWith("pt_")) return false;
  if (!kvEnabled()) {
    const record = memPollTokens.get(token);
    if (!record) return false;
    if (Date.now() > record.expiresAt) {
      memPollTokens.delete(token);
      return false;
    }
    return record.pendingId === pendingId;
  }
  const record = await kvGet<PollTokenRecord>(`${POLL_TOKEN_INDEX_PREFIX}${token}`);
  if (!record) return false;
  if (Date.now() > record.expiresAt) return false;
  return record.pendingId === pendingId;
}

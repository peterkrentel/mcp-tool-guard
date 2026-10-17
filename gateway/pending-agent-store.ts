/**
 * Short-lived, in-memory tracking for the async agent-creation flow.
 *
 * POST /agents used to await idpAdapter.createAgent() synchronously within
 * the HTTP request. For Entra, createAgent() can take 30+ seconds in the
 * worst case (Graph eventual-consistency retries in entra-mgmt.ts's
 * fetchGraphWithConsistencyRetry()), which left the browser tab looking
 * hung for the whole duration. POST /agents now returns a pendingId
 * immediately and finishes the real creation in the background; the UI
 * polls GET /agents/pending/:id until it observes "active" or "failed".
 *
 * This is deliberately NOT the durable agent record (see agent-store.ts,
 * which is unchanged) — it's a transient, single-process progress tracker
 * that only needs to survive a few tens of seconds of polling. In-memory is
 * the correct choice: no need to survive a process restart, and KV would
 * add durability this state doesn't need.
 */

export interface PendingAgentEntry {
  status: "pending" | "active" | "failed";
  name: string;
  serverId: string;
  scopes: string[];
  provider: string;
  createdAt: string;
  clientId?: string;
  clientSecret?: string; // plaintext, one-time reveal only — see getAndConsumePendingAgent
  error?: string;
}

export interface CreatePendingAgentInput {
  name: string;
  serverId: string;
  scopes: string[];
  provider: string;
}

const PENDING_AGENT_TTL_MS = 5 * 60 * 1000; // 5 minutes — comfortably past the ~31s worst-case retry chain

const pendingAgents = new Map<string, PendingAgentEntry>();

export function createPendingAgent(input: CreatePendingAgentInput): string {
  const id = crypto.randomUUID();
  pendingAgents.set(id, {
    status: "pending",
    name: input.name,
    serverId: input.serverId,
    scopes: input.scopes,
    provider: input.provider,
    createdAt: new Date().toISOString(),
  });

  const timer = setTimeout(() => {
    pendingAgents.delete(id);
  }, PENDING_AGENT_TTL_MS);
  timer.unref?.();

  return id;
}

export function markPendingAgentActive(
  id: string,
  clientId: string,
  clientSecret: string,
): void {
  const entry = pendingAgents.get(id);
  if (!entry) return; // poller may have already given up / entry expired — no-op
  entry.status = "active";
  entry.clientId = clientId;
  entry.clientSecret = clientSecret;
}

export function markPendingAgentFailed(id: string, error: string): void {
  const entry = pendingAgents.get(id);
  if (!entry) return; // poller may have already given up / entry expired — no-op
  entry.status = "failed";
  entry.error = error;
}

export function getAndConsumePendingAgent(id: string): PendingAgentEntry | null {
  const entry = pendingAgents.get(id);
  if (!entry) return null;

  const copy: PendingAgentEntry = { ...entry };

  // One-time reveal: once an "active" entry's secret has been observed by a
  // poller, clear it from the stored entry so a later poll (possibly from a
  // different tab/request) can't read it again — same principle as
  // ActiveAgent.secretShown in ui/src/agents-main.ts, enforced server-side
  // here since polling could happen more than once.
  if (entry.status === "active" && entry.clientSecret !== undefined) {
    entry.clientSecret = undefined;
  }

  return copy;
}

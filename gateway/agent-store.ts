import { decryptClientSecret } from "./agent-secrets.js";
import type { IdpProviderId } from "./idp-adapter.js";
import { kvDel, kvGet, kvMget, kvScan, kvSet } from "./kv.js";

export interface StoredAgentRecord {
  id: string;
  name: string;
  serverId: string;
  scopes: string[];
  auth0ClientId: string;
  auth0AppName: string;
  /** Which IdP created this agent — see gateway/idp-adapter.ts. */
  provider: IdpProviderId;
  status: "active";
  createdAt: string;
  /** AES-GCM blob — never returned from GET /agents */
  clientSecretEnc?: string;
}

/** Agent metadata safe for API responses. */
export type PublicAgentRecord = Omit<StoredAgentRecord, "clientSecretEnc">;

const AGENT_PREFIX = "gateway:agents:";

function agentKey(clientId: string): string {
  return `${AGENT_PREFIX}${clientId}`;
}

export function toPublicAgent(record: StoredAgentRecord): PublicAgentRecord {
  const { clientSecretEnc: _secret, ...publicRecord } = record;
  return publicRecord;
}

/**
 * Read-time default for records persisted before `provider` existed on
 * StoredAgentRecord. Entra never existed as an active option before this
 * field was added, so every such record is provably Auth0's. This never
 * writes back to KV — it's purely a display-time normalization.
 */
function normalizeAgentRecord(record: StoredAgentRecord): StoredAgentRecord {
  return record.provider ? record : { ...record, provider: "auth0" };
}

export async function saveAgent(record: StoredAgentRecord): Promise<void> {
  await kvSet(agentKey(record.auth0ClientId), record);
}

export async function getAgent(clientId: string): Promise<StoredAgentRecord | null> {
  const record = await kvGet<StoredAgentRecord>(agentKey(clientId));
  return record ? normalizeAgentRecord(record) : null;
}

export async function deleteAgent(clientId: string): Promise<void> {
  await kvDel(agentKey(clientId));
}

export async function listAgents(): Promise<PublicAgentRecord[]> {
  const keys = await kvScan(`${AGENT_PREFIX}*`);
  const stored = await kvMget<StoredAgentRecord>(keys);
  const records = stored
    .filter((r): r is StoredAgentRecord => r != null && r.status === "active")
    .map(normalizeAgentRecord)
    .map(toPublicAgent);
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return records;
}

export async function getAgentClientSecret(clientId: string): Promise<string | null> {
  const record = await getAgent(clientId);
  if (!record?.clientSecretEnc) return null;
  return decryptClientSecret(record.clientSecretEnc);
}

export function buildAgentRecord(input: {
  name: string;
  serverId: string;
  scopes: string[];
  auth0ClientId: string;
  auth0AppName: string;
  provider: IdpProviderId;
  clientSecretEnc?: string;
}): StoredAgentRecord {
  return {
    id: input.auth0ClientId,
    name: input.name,
    serverId: input.serverId,
    scopes: input.scopes,
    auth0ClientId: input.auth0ClientId,
    auth0AppName: input.auth0AppName,
    provider: input.provider,
    status: "active",
    createdAt: new Date().toISOString(),
    ...(input.clientSecretEnc ? { clientSecretEnc: input.clientSecretEnc } : {}),
  };
}

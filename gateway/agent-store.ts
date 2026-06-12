import { decryptClientSecret } from "./agent-secrets.js";
import { kvDel, kvGet, kvScan, kvSet } from "./kv.js";

export interface StoredAgentRecord {
  id: string;
  name: string;
  serverId: string;
  scopes: string[];
  auth0ClientId: string;
  auth0AppName: string;
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

export async function saveAgent(record: StoredAgentRecord): Promise<void> {
  await kvSet(agentKey(record.auth0ClientId), record);
}

export async function getAgent(clientId: string): Promise<StoredAgentRecord | null> {
  return kvGet<StoredAgentRecord>(agentKey(clientId));
}

export async function deleteAgent(clientId: string): Promise<void> {
  await kvDel(agentKey(clientId));
}

export async function listAgents(): Promise<PublicAgentRecord[]> {
  const keys = await kvScan(`${AGENT_PREFIX}*`);
  const records: PublicAgentRecord[] = [];
  for (const relativeKey of keys) {
    const record = await kvGet<StoredAgentRecord>(relativeKey);
    if (record && record.status === "active") {
      records.push(toPublicAgent(record));
    }
  }
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
  clientSecretEnc?: string;
}): StoredAgentRecord {
  return {
    id: input.auth0ClientId,
    name: input.name,
    serverId: input.serverId,
    scopes: input.scopes,
    auth0ClientId: input.auth0ClientId,
    auth0AppName: input.auth0AppName,
    status: "active",
    createdAt: new Date().toISOString(),
    ...(input.clientSecretEnc ? { clientSecretEnc: input.clientSecretEnc } : {}),
  };
}

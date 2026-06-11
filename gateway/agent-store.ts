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
}

const AGENT_PREFIX = "gateway:agents:";

function agentKey(clientId: string): string {
  return `${AGENT_PREFIX}${clientId}`;
}

export async function saveAgent(record: StoredAgentRecord): Promise<void> {
  await kvSet(agentKey(record.auth0ClientId), record);
}

export async function deleteAgent(clientId: string): Promise<void> {
  await kvDel(agentKey(clientId));
}

export async function listAgents(): Promise<StoredAgentRecord[]> {
  const keys = await kvScan(`${AGENT_PREFIX}*`);
  const records: StoredAgentRecord[] = [];
  for (const relativeKey of keys) {
    const record = await kvGet<StoredAgentRecord>(relativeKey);
    if (record && record.status === "active") {
      records.push(record);
    }
  }
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return records;
}

export function buildAgentRecord(input: {
  name: string;
  serverId: string;
  scopes: string[];
  auth0ClientId: string;
  auth0AppName: string;
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
  };
}

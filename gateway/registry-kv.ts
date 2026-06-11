import { kvDel, kvGet, kvScan, kvSet } from "./kv.js";
import type { ServerRegistry } from "./server-registry.js";

const SERVER_PREFIX = "gateway:servers:";

export interface KvServerEntry {
  url: string;
  scopes: Record<string, string[]>;
}

function serverKey(id: string): string {
  return `${SERVER_PREFIX}${id}`;
}

export async function persistServer(id: string, entry: KvServerEntry): Promise<void> {
  await kvSet(serverKey(id), entry);
}

export async function removeServerFromKv(id: string): Promise<void> {
  await kvDel(serverKey(id));
}

/** Load runtime-added servers from KV; skip ids already seeded from yaml. */
export async function loadServersFromKv(
  registry: ServerRegistry,
  seedIds: ReadonlySet<string>,
): Promise<number> {
  const keys = await kvScan(`${SERVER_PREFIX}*`);
  let loaded = 0;
  for (const relativeKey of keys) {
    const id = relativeKey.slice(SERVER_PREFIX.length);
    if (!id || seedIds.has(id)) continue;
    const entry = await kvGet<KvServerEntry>(relativeKey);
    if (!entry?.url) continue;
    const result = registry.add({ id, url: entry.url, scopes: entry.scopes ?? {} });
    if (result.ok) loaded += 1;
  }
  return loaded;
}

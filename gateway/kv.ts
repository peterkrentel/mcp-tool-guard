/**
 * Upstash Redis REST client for guard proxy persistence.
 * No-op when KV_REST_API_URL / KV_REST_API_TOKEN are unset (local dev).
 */

const REST_URL = () => process.env.KV_REST_API_URL?.trim() ?? "";
const REST_TOKEN = () => process.env.KV_REST_API_TOKEN?.trim() ?? "";

/** Namespace for gateway keys — see docs/kv-design.md */
export function gatewayKvPrefix(): string {
  const raw = process.env.GATEWAY_KV_PREFIX?.trim() || "mcp-tool-guard:gateway:";
  return raw.endsWith(":") ? raw : `${raw}:`;
}

export function kvEnabled(): boolean {
  if (typeof process === "undefined") return false;
  return Boolean(REST_URL() && REST_TOKEN());
}

function fullKey(relativeKey: string): string {
  return `${gatewayKvPrefix()}${relativeKey}`;
}

async function kvRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  if (!kvEnabled()) return null;
  const url = `${REST_URL().replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${REST_TOKEN()}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`KV ${init?.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { result?: T };
  return data.result ?? null;
}

export async function kvGet<T>(relativeKey: string): Promise<T | null> {
  if (!kvEnabled()) return null;
  const encoded = encodeURIComponent(fullKey(relativeKey));
  const raw = await kvRequest<string>(`/get/${encoded}`);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

/** Batched GET — one Redis MGET command instead of one GET per key. Order matches `relativeKeys`. */
export async function kvMget<T>(relativeKeys: string[]): Promise<(T | null)[]> {
  if (!kvEnabled() || relativeKeys.length === 0) return relativeKeys.map(() => null);
  const encoded = relativeKeys.map((k) => encodeURIComponent(fullKey(k))).join("/");
  const raw = (await kvRequest<(string | null)[]>(`/mget/${encoded}`)) ?? [];
  return relativeKeys.map((_, i) => {
    const value = raw[i];
    if (value == null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  });
}

export async function kvSet(relativeKey: string, value: unknown, ttlSec?: number): Promise<void> {
  if (!kvEnabled()) return;
  const encoded = encodeURIComponent(fullKey(relativeKey));
  const payload = JSON.stringify(value);
  const path = ttlSec ? `/set/${encoded}?EX=${ttlSec}` : `/set/${encoded}`;
  await kvRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
}

export async function kvDel(relativeKey: string): Promise<void> {
  if (!kvEnabled()) return;
  const encoded = encodeURIComponent(fullKey(relativeKey));
  await kvRequest(`/del/${encoded}`, { method: "POST" });
}

/** Scan keys matching `{prefix}{relativePattern}` (relativePattern may include `*`). */
export async function kvScan(relativePattern: string): Promise<string[]> {
  if (!kvEnabled()) return [];
  const match = fullKey(relativePattern);
  const keys: string[] = [];
  let cursor = "0";
  const prefix = gatewayKvPrefix();

  do {
    // Upstash REST: SCAN cursor MATCH pattern COUNT n (path segments, not query params)
    const path = `/scan/${encodeURIComponent(cursor)}/match/${encodeURIComponent(match)}/count/100`;
    const result = await kvRequest<[string | number, string[]]>(path);
    if (!result) break;
    cursor = String(result[0]);
    for (const key of result[1] ?? []) {
      if (key.startsWith(prefix)) {
        keys.push(key.slice(prefix.length));
      }
    }
  } while (cursor !== "0");

  return keys;
}

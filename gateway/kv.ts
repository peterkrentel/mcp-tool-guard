/**
 * Upstash Redis REST client for guard proxy persistence.
 * Falls back to a local JSON file in non-production when KV_REST_API_URL /
 * KV_REST_API_TOKEN are unset.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REST_URL = () => process.env.KV_REST_API_URL?.trim() ?? "";
const REST_TOKEN = () => process.env.KV_REST_API_TOKEN?.trim() ?? "";

type LocalKvEntry = {
  value: unknown;
  expiresAt?: number;
};

type LocalKvStore = Record<string, LocalKvEntry>;

let cachedLocalFile = "";
let cachedLocalStore: LocalKvStore | null = null;

function gatewayRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return here.endsWith(`${sep}dist`) ? resolve(here, "..") : here;
}

const gatewayDir = gatewayRoot();
const repoRoot = resolve(gatewayDir, "..");

/** Namespace for gateway keys — see docs/kv-design.md */
export function gatewayKvPrefix(): string {
  const raw = process.env.GATEWAY_KV_PREFIX?.trim() || "mcp-tool-guard:gateway:";
  return raw.endsWith(":") ? raw : `${raw}:`;
}

function remoteKvEnabled(): boolean {
  if (typeof process === "undefined") return false;
  return Boolean(REST_URL() && REST_TOKEN());
}

function localKvEnabled(): boolean {
  if (typeof process === "undefined") return false;
  if (remoteKvEnabled()) return false;
  return process.env.NODE_ENV !== "production";
}

function localKvFile(): string {
  const configured = process.env.MCP_LOCAL_KV_FILE?.trim();
  if (configured) {
    return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  }
  return resolve(repoRoot, "memory", "gateway-local-kv.json");
}

function normalizeLocalStore(data: unknown): LocalKvStore {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const store: LocalKvStore = {};
  for (const [key, rawValue] of Object.entries(data as Record<string, unknown>)) {
    if (
      rawValue
      && typeof rawValue === "object"
      && !Array.isArray(rawValue)
      && Object.hasOwn(rawValue, "value")
    ) {
      const entry = rawValue as { value?: unknown; expiresAt?: unknown };
      store[key] = {
        value: entry.value,
        ...(typeof entry.expiresAt === "number" ? { expiresAt: entry.expiresAt } : {}),
      };
      continue;
    }
    store[key] = { value: rawValue };
  }
  return store;
}

function readLocalStore(file: string): LocalKvStore {
  if (!existsSync(file)) return {};
  try {
    return normalizeLocalStore(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

function saveLocalStore(file: string, store: LocalKvStore): void {
  mkdirSync(dirname(file), { recursive: true });
  const tempFile = `${file}.tmp`;
  writeFileSync(tempFile, JSON.stringify(store, null, 2));
  renameSync(tempFile, file);
}

function pruneExpiredLocalEntries(store: LocalKvStore): boolean {
  let changed = false;
  const now = Date.now();
  for (const [key, entry] of Object.entries(store)) {
    if (typeof entry.expiresAt === "number" && entry.expiresAt <= now) {
      delete store[key];
      changed = true;
    }
  }
  return changed;
}

function ensureLocalStore(): { file: string; store: LocalKvStore } | null {
  if (!localKvEnabled()) return null;
  const file = localKvFile();
  if (!cachedLocalStore || cachedLocalFile !== file) {
    cachedLocalFile = file;
    cachedLocalStore = readLocalStore(file);
  }
  if (pruneExpiredLocalEntries(cachedLocalStore)) {
    saveLocalStore(file, cachedLocalStore);
  }
  return { file, store: cachedLocalStore };
}

function localPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}

export function kvEnabled(): boolean {
  if (typeof process === "undefined") return false;
  return remoteKvEnabled() || localKvEnabled();
}

function fullKey(relativeKey: string): string {
  return `${gatewayKvPrefix()}${relativeKey}`;
}

async function kvRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  if (!remoteKvEnabled()) return null;
  const url = `${REST_URL().replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer " + REST_TOKEN(),
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
  if (remoteKvEnabled()) {
    const encoded = encodeURIComponent(fullKey(relativeKey));
    const raw = await kvRequest<string>(`/get/${encoded}`);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  const local = ensureLocalStore();
  if (!local) return null;
  const entry = local.store[fullKey(relativeKey)];
  return (entry?.value as T | undefined) ?? null;
}

/** Batched GET — one Redis MGET command instead of one GET per key. Order matches `relativeKeys`. */
export async function kvMget<T>(relativeKeys: string[]): Promise<(T | null)[]> {
  if (relativeKeys.length === 0) return [];
  if (remoteKvEnabled()) {
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

  return Promise.all(relativeKeys.map((key) => kvGet<T>(key)));
}

export async function kvSet(relativeKey: string, value: unknown, ttlSec?: number): Promise<void> {
  if (remoteKvEnabled()) {
    const encoded = encodeURIComponent(fullKey(relativeKey));
    const payload = JSON.stringify(value);
    const path = ttlSec ? `/set/${encoded}?EX=${ttlSec}` : `/set/${encoded}`;
    await kvRequest(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    return;
  }

  const local = ensureLocalStore();
  if (!local) return;
  local.store[fullKey(relativeKey)] = {
    value,
    ...(ttlSec ? { expiresAt: Date.now() + ttlSec * 1000 } : {}),
  };
  saveLocalStore(local.file, local.store);
}

export async function kvDel(relativeKey: string): Promise<void> {
  if (remoteKvEnabled()) {
    const encoded = encodeURIComponent(fullKey(relativeKey));
    await kvRequest(`/del/${encoded}`, { method: "POST" });
    return;
  }

  const local = ensureLocalStore();
  if (!local) return;
  if (!Object.hasOwn(local.store, fullKey(relativeKey))) return;
  delete local.store[fullKey(relativeKey)];
  saveLocalStore(local.file, local.store);
}

/** Scan keys matching `{prefix}{relativePattern}` (relativePattern may include `*`). */
export async function kvScan(relativePattern: string): Promise<string[]> {
  if (remoteKvEnabled()) {
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

  const local = ensureLocalStore();
  if (!local) return [];
  const fullPattern = fullKey(relativePattern);
  const matcher = localPatternToRegExp(fullPattern);
  const prefix = gatewayKvPrefix();
  return Object.keys(local.store)
    .filter((key) => matcher.test(key))
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

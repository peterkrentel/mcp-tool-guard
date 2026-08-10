import assert from "node:assert/strict";
import { test } from "node:test";

process.env.KV_REST_API_URL = "https://mock-kv.example.com";
process.env.KV_REST_API_TOKEN = "mock-kv-token";

const { saveAgent, getAgent, listAgents, buildAgentRecord } = await import(
  "../dist/agent-store.js"
);
const { gatewayKvPrefix } = await import("../dist/kv.js");

/**
 * Minimal in-memory stand-in for the Upstash REST API that kv.ts talks to.
 * Mirrors auth0-mgmt.test.mjs's convention of stubbing global.fetch and
 * recording every call so tests can assert on which HTTP verbs happened.
 */
function makeFetchMock() {
  const store = new Map();
  const calls = [];

  const fetchMock = async (url, init) => {
    const method = init?.method ?? "GET";
    const u = new URL(String(url));
    calls.push({ url: String(url), method });
    const parts = u.pathname.split("/").filter(Boolean);
    const [cmd] = parts;

    if (cmd === "get") {
      const key = decodeURIComponent(parts[1]);
      return { ok: true, json: async () => ({ result: store.has(key) ? store.get(key) : null }) };
    }
    if (cmd === "mget") {
      const keys = parts.slice(1).map(decodeURIComponent);
      const result = keys.map((k) => (store.has(k) ? store.get(k) : null));
      return { ok: true, json: async () => ({ result }) };
    }
    if (cmd === "set") {
      const key = decodeURIComponent(parts[1]);
      store.set(key, init?.body);
      return { ok: true, json: async () => ({ result: "OK" }) };
    }
    if (cmd === "del") {
      const key = decodeURIComponent(parts[1]);
      store.delete(key);
      return { ok: true, json: async () => ({ result: 1 }) };
    }
    if (cmd === "scan") {
      // /scan/{cursor}/match/{pattern}/count/100
      const pattern = decodeURIComponent(parts[3]);
      const prefix = pattern.replace(/\*$/, "");
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return { ok: true, json: async () => ({ result: ["0", keys] }) };
    }
    throw new Error(`Unhandled mock KV request: ${method} ${u.pathname}`);
  };

  return { fetchMock, store, calls };
}

function fullKey(relativeKey) {
  return `${gatewayKvPrefix()}${relativeKey}`;
}

function withMockFetch(fetchMock, fn) {
  const original = global.fetch;
  global.fetch = fetchMock;
  return Promise.resolve(fn()).finally(() => {
    global.fetch = original;
  });
}

test("agent record created with provider: entra round-trips through save/get/list", async () => {
  const { fetchMock, calls } = makeFetchMock();

  await withMockFetch(fetchMock, async () => {
    const record = buildAgentRecord({
      name: "entra-agent",
      serverId: "flight",
      scopes: ["flights:read"],
      auth0ClientId: "entra-client-id-1",
      auth0AppName: "mcp-agent-entra-agent",
      provider: "entra",
    });

    await saveAgent(record);

    const fetched = await getAgent("entra-client-id-1");
    assert.ok(fetched);
    assert.equal(fetched.provider, "entra");

    const listed = await listAgents();
    const match = listed.find((a) => a.id === "entra-client-id-1");
    assert.ok(match);
    assert.equal(match.provider, "entra");
  });

  // Sanity check the mock actually exercised the KV write path for this test.
  assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/set/")));
});

test("pre-existing record without a provider field defaults to auth0 on read, without writing back to KV", async () => {
  const { fetchMock, store, calls } = makeFetchMock();

  // Simulate a record persisted before `provider` existed: no `provider`
  // key at all, seeded directly into the mock KV store (not via saveAgent).
  const legacyRecord = {
    id: "legacy-client-id",
    name: "legacy-agent",
    serverId: "flight",
    scopes: ["flights:read"],
    auth0ClientId: "legacy-client-id",
    auth0AppName: "mcp-agent-legacy-agent",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  store.set(fullKey(`gateway:agents:legacy-client-id`), JSON.stringify(legacyRecord));

  await withMockFetch(fetchMock, async () => {
    const fetched = await getAgent("legacy-client-id");
    assert.ok(fetched);
    assert.equal(fetched.provider, "auth0");

    const listed = await listAgents();
    const match = listed.find((a) => a.id === "legacy-client-id");
    assert.ok(match);
    assert.equal(match.provider, "auth0");
  });

  // The normalization is read-time only — no write (POST /set) should have
  // happened as a side effect of getAgent()/listAgents() defaulting the field.
  assert.ok(!calls.some((c) => c.method === "POST" && c.url.includes("/set/")));
  // Confirm the underlying stored blob is still missing `provider` — proof
  // nothing was migrated/rewritten in the backing store either.
  const raw = JSON.parse(store.get(fullKey(`gateway:agents:legacy-client-id`)));
  assert.equal("provider" in raw, false);
});

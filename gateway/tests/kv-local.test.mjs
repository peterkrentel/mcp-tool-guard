import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "gateway-local-kv-"));
  tempDirs.push(dir);
  return dir;
}

process.on("exit", () => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function freshKvModule(label) {
  return import(new URL(`../dist/kv.js?${label}-${Date.now()}-${Math.random()}`, import.meta.url).href);
}

async function withLocalKv(file, fn) {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    MCP_LOCAL_KV_FILE: process.env.MCP_LOCAL_KV_FILE,
  };

  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.NODE_ENV;
  process.env.MCP_LOCAL_KV_FILE = file;

  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("local KV persists across a fresh module load", async () => {
  const dir = makeTempDir();
  const file = join(dir, "local-kv.json");

  await withLocalKv(file, async () => {
    const kv1 = await freshKvModule("persist-1");
    assert.equal(kv1.kvEnabled(), true);
    await kv1.kvSet("gateway:agents:test-client", { id: "test-client", scopes: ["repo:read"] });

    assert.equal(existsSync(file), true);
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    const stored = onDisk["mcp-tool-guard:gateway:gateway:agents:test-client"];
    assert.deepEqual(stored.value, { id: "test-client", scopes: ["repo:read"] });

    const kv2 = await freshKvModule("persist-2");
    assert.deepEqual(
      await kv2.kvGet("gateway:agents:test-client"),
      { id: "test-client", scopes: ["repo:read"] },
    );
  });
});

test("local KV supports scan, mget, and delete", async () => {
  const dir = makeTempDir();
  const file = join(dir, "local-kv.json");

  await withLocalKv(file, async () => {
    const kv = await freshKvModule("ops");
    await kv.kvSet("gateway:agents:one", { id: 1 });
    await kv.kvSet("gateway:agents:two", { id: 2 });
    await kv.kvSet("gateway:servers:alpha", { id: "alpha" });

    const keys = (await kv.kvScan("gateway:agents:*")).sort();
    assert.deepEqual(keys, ["gateway:agents:one", "gateway:agents:two"]);

    const values = await kv.kvMget(keys);
    assert.deepEqual(values, [{ id: 1 }, { id: 2 }]);

    await kv.kvDel("gateway:agents:one");
    assert.equal(await kv.kvGet("gateway:agents:one"), null);
    assert.deepEqual(await kv.kvScan("gateway:agents:*"), ["gateway:agents:two"]);
  });
});

test("local KV honors ttl expiration", async () => {
  const dir = makeTempDir();
  const file = join(dir, "local-kv.json");

  await withLocalKv(file, async () => {
    const kv = await freshKvModule("ttl");
    await kv.kvSet("gateway:ratelimit:test:1", 1, 1);
    assert.equal(await kv.kvGet("gateway:ratelimit:test:1"), 1);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    assert.equal(await kv.kvGet("gateway:ratelimit:test:1"), null);
    assert.deepEqual(await kv.kvScan("gateway:ratelimit:*"), []);
  });
});

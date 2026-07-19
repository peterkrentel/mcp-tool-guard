import assert from "node:assert/strict";
import { test } from "node:test";

import { pendingLongPollMaxMs } from "../dist/env.js";
import {
  createPendingRequest,
  resolvePendingRequest,
  waitForPendingResolution,
} from "../dist/pending-store.js";

function withEnv(key, value, fn) {
  const saved = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
}

test("pendingLongPollMaxMs() defaults to 120000ms when unset", () => {
  withEnv("MCP_PENDING_LONGPOLL_MAX_MS", undefined, () => {
    assert.equal(pendingLongPollMaxMs(), 120_000);
  });
});

test("pendingLongPollMaxMs() parses a valid override", () => {
  withEnv("MCP_PENDING_LONGPOLL_MAX_MS", "5000", () => {
    assert.equal(pendingLongPollMaxMs(), 5000);
  });
});

test("pendingLongPollMaxMs() falls back to default on invalid value", () => {
  withEnv("MCP_PENDING_LONGPOLL_MAX_MS", "not-a-number", () => {
    assert.equal(pendingLongPollMaxMs(), 120_000);
  });
  withEnv("MCP_PENDING_LONGPOLL_MAX_MS", "-100", () => {
    assert.equal(pendingLongPollMaxMs(), 120_000);
  });
});

test("waitForPendingResolution() returns the record immediately when already resolved", async () => {
  const pending = await createPendingRequest({
    server_id: "unit-test-server",
    tool: "unit_test_tool",
    required_scope: "unit:write",
    token_scopes: ["unit:read"],
  });
  await resolvePendingRequest(pending.id, "approved", "unit-test");

  const start = Date.now();
  const resolved = await waitForPendingResolution(pending.id, 3000, 50);
  const elapsed = Date.now() - start;

  assert.equal(resolved?.status, "approved");
  assert.ok(elapsed < 200, `expected near-instant return, took ${elapsed}ms`);
});

test("waitForPendingResolution() detects approval that happens mid-wait", async () => {
  const pending = await createPendingRequest({
    server_id: "unit-test-server",
    tool: "unit_test_tool",
    required_scope: "unit:write",
    token_scopes: ["unit:read"],
  });

  setTimeout(() => {
    resolvePendingRequest(pending.id, "approved", "unit-test-async");
  }, 150);

  const start = Date.now();
  const resolved = await waitForPendingResolution(pending.id, 3000, 50);
  const elapsed = Date.now() - start;

  assert.equal(resolved?.status, "approved");
  assert.ok(elapsed >= 150, `expected to wait at least 150ms, took ${elapsed}ms`);
  assert.ok(elapsed < 1000, `expected prompt detection, took ${elapsed}ms`);
});

test("waitForPendingResolution() returns the still-pending record after max wait elapses", async () => {
  const pending = await createPendingRequest({
    server_id: "unit-test-server",
    tool: "unit_test_tool",
    required_scope: "unit:write",
    token_scopes: ["unit:read"],
  });

  const start = Date.now();
  const resolved = await waitForPendingResolution(pending.id, 300, 50);
  const elapsed = Date.now() - start;

  assert.equal(resolved?.status, "pending");
  assert.ok(elapsed >= 280, `expected to wait out the max, took ${elapsed}ms`);
});

test("waitForPendingResolution() returns null for an unknown pending id", async () => {
  const resolved = await waitForPendingResolution("pr_does_not_exist", 200, 50);
  assert.equal(resolved, null);
});

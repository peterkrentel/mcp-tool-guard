import assert from "node:assert/strict";
import { test } from "node:test";

const {
  createPendingAgent,
  markPendingAgentActive,
  markPendingAgentFailed,
  getAndConsumePendingAgent,
} = await import("../dist/pending-agent-store.js");

test("createPendingAgent returns an id and starts in pending status", () => {
  const id = createPendingAgent({
    name: "agent-a",
    serverId: "flight",
    scopes: ["flights:read"],
    provider: "entra",
  });
  assert.equal(typeof id, "string");
  assert.ok(id.length > 0);

  const entry = getAndConsumePendingAgent(id);
  assert.ok(entry);
  assert.equal(entry.status, "pending");
  assert.equal(entry.name, "agent-a");
  assert.equal(entry.serverId, "flight");
  assert.deepEqual(entry.scopes, ["flights:read"]);
  assert.equal(entry.provider, "entra");
  assert.equal(entry.clientId, undefined);
  assert.equal(entry.clientSecret, undefined);
});

test("markPendingAgentActive: secret is revealed exactly once", () => {
  const id = createPendingAgent({
    name: "agent-b",
    serverId: "flight",
    scopes: ["flights:read"],
    provider: "auth0",
  });

  markPendingAgentActive(id, "client-123", "s3cr3t");

  const first = getAndConsumePendingAgent(id);
  assert.equal(first.status, "active");
  assert.equal(first.clientId, "client-123");
  assert.equal(first.clientSecret, "s3cr3t");

  const second = getAndConsumePendingAgent(id);
  assert.equal(second.status, "active");
  assert.equal(second.clientId, "client-123");
  assert.equal(second.clientSecret, undefined, "secret must not be revealed a second time");
});

test("markPendingAgentFailed sets status and error message", () => {
  const id = createPendingAgent({
    name: "agent-c",
    serverId: "flight",
    scopes: ["flights:read"],
    provider: "entra",
  });

  markPendingAgentFailed(id, "Graph API timed out");

  const entry = getAndConsumePendingAgent(id);
  assert.equal(entry.status, "failed");
  assert.equal(entry.error, "Graph API timed out");
});

test("mark* functions silently no-op for an unknown/expired id", () => {
  assert.doesNotThrow(() => markPendingAgentActive("nonexistent-id", "client-x", "secret-x"));
  assert.doesNotThrow(() => markPendingAgentFailed("nonexistent-id", "boom"));
});

test("getAndConsumePendingAgent returns null for a nonexistent/expired id", () => {
  const entry = getAndConsumePendingAgent("nonexistent-id");
  assert.equal(entry, null);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { test, before, after } from "node:test";

import { SignJWT } from "jose";

const PORT = 18987;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let child;
let privateKey;

function makeToken(scopes) {
  return new SignJWT({ scope: scopes.join(" ") })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
}

async function waitForHealth() {
  const attempts = 60;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // keep trying until server is up
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Proxy did not become healthy in time");
}

async function createPendingRequest() {
  const readToken = await makeToken(["flights:read"]);
  const pendingRes = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${readToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_booking_tool",
        arguments: {
          flight_id: "FL001",
          passenger_name: "Ada Lovelace",
          seat: "12A",
        },
      },
    }),
  });
  assert.equal(pendingRes.status, 202);
  const pendingBody = await pendingRes.json();
  const pendingId = pendingBody?.result?.pending_id;
  const pendingPollToken = pendingBody?.result?.pending_poll_token;
  assert.ok(typeof pendingId === "string" && pendingId.length > 0);
  assert.ok(typeof pendingPollToken === "string" && pendingPollToken.length > 0);
  return { pendingId, pendingPollToken };
}

async function addServer(serverId, overrides = {}) {
  const adminToken = await makeToken(["gateway:admin"]);
  const res = await fetch(`${BASE_URL}/servers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      id: serverId,
      url: `https://example.com/${serverId}/mcp`,
      scopes: {
        demo_tool: ["demo:read"],
      },
      ...overrides,
    }),
  });
  return res;
}

before(async () => {
  const { publicKey, privateKey: priv } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  privateKey = priv;
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  child = spawn("node", ["dist/proxy-server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MCP_PROXY_PORT: String(PORT),
      MCP_GUARD_ENABLED: "true",
      MCP_GUARD_PUBLIC_KEY_PEM: publicPem,
      MCP_JWT_ISSUER: "https://issuer.example",
      MCP_JWT_AUDIENCE: "mcp-tool-guard",
      MCP_APPROVAL_QUEUE: "true",
      MCP_AUDIT_AGENT_TRUSTED_MODE: "false",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });

  await waitForHealth();
});

after(async () => {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (!child.killed) child.kill("SIGKILL");
});

test("POST /audit/agent rejects missing bearer", async () => {
  const res = await fetch(`${BASE_URL}/audit/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entry: {
        server: "flight",
        tool: "search_flights_tool",
        required_scope: "flights:read",
        token_scopes: ["flights:read"],
        decision: "allow",
      },
    }),
  });
  assert.equal(res.status, 401);
});

test("GET /health returns expected baseline flags", async () => {
  const res = await fetch(`${BASE_URL}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, "mcp-tool-guard-proxy");
  assert.equal(body.guard_enabled, true);
  assert.equal(body.jwt_trust_enabled, true);
  assert.equal(body.approval_queue_enabled, true);
  assert.ok(Array.isArray(body.servers));
  assert.ok(body.servers.includes("flight"));
});

test("GET /audit rejects missing bearer when guard is enabled", async () => {
  const res = await fetch(`${BASE_URL}/audit`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.match(String(body.error ?? ""), /Missing Authorization: Bearer/i);
});

test("GET /audit allows bearer and returns sources", async () => {
  const token = await makeToken(["audit:write"]);
  const res = await fetch(`${BASE_URL}/audit`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.entries));
  assert.deepEqual(body.sources, ["agent", "proxy", "mcp"]);
});

test("POST /audit/agent allows audit:write bearer", async () => {
  const token = await makeToken(["audit:write"]);
  const res = await fetch(`${BASE_URL}/audit/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      entry: {
        server: "flight",
        tool: "search_flights_tool",
        required_scope: "flights:read",
        token_scopes: ["flights:read"],
        decision: "allow",
      },
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.count, 1);
});

test("POST /mcp tools/call rejects missing bearer", async () => {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "missing-bearer",
      method: "tools/call",
      params: { name: "search_flights_tool", arguments: { from: "SFO", to: "LAX" } },
    }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, "missing-bearer");
  assert.match(
    String(body?.error?.message ?? ""),
    /(missing bearer token|jwt validation failed)/i,
  );
});

test("GET /servers lists seeded registry entries without auth", async () => {
  const res = await fetch(`${BASE_URL}/servers`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.servers));
  assert.ok(body.servers.some((server) => server.id === "flight"));
});

test("GET /agents returns agent list without auth", async () => {
  const res = await fetch(`${BASE_URL}/agents`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.agents));
});

test("POST /agents requires admin bearer when control plane auth is enabled", async () => {
  const res = await fetch(`${BASE_URL}/agents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "agent-no-auth",
      scopes: ["flights:read"],
    }),
  });
  assert.equal(res.status, 401);
});

test("DELETE /agents/:clientId requires admin bearer when control plane auth is enabled", async () => {
  const res = await fetch(`${BASE_URL}/agents/some-client-id`, {
    method: "DELETE",
  });
  assert.equal(res.status, 401);
});

test("POST /token returns 503 when Auth0 vending is not configured", async () => {
  const res = await fetch(`${BASE_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientId: "client-id",
      clientSecret: "client-secret",
    }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.match(String(body.error ?? ""), /AUTH0_DOMAIN and AUTH0_AUDIENCE required/i);
});

test("POST /agents/:clientId/token returns 503 when Auth0 vending is not configured", async () => {
  const res = await fetch(`${BASE_URL}/agents/some-client-id/token`, {
    method: "POST",
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.match(String(body.error ?? ""), /AUTH0_DOMAIN and AUTH0_AUDIENCE required/i);
});

test("POST /servers requires admin bearer when control plane auth is enabled", async () => {
  const res = await fetch(`${BASE_URL}/servers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "server-no-auth",
      url: "https://example.com/server-no-auth/mcp",
      scopes: { demo_tool: ["demo:read"] },
    }),
  });
  assert.equal(res.status, 401);
});

test("POST /servers adds server and DELETE /servers/:id removes it", async () => {
  const serverId = `server-${Date.now()}`;
  const createRes = await addServer(serverId);
  assert.equal(createRes.status, 201);
  const createBody = await createRes.json();
  assert.equal(createBody.id, serverId);
  assert.equal(createBody.persisted, false);

  const listRes = await fetch(`${BASE_URL}/servers`);
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.ok(listBody.servers.some((server) => server.id === serverId));

  const noAuthDelete = await fetch(`${BASE_URL}/servers/${encodeURIComponent(serverId)}`, {
    method: "DELETE",
  });
  assert.equal(noAuthDelete.status, 401);

  const adminToken = await makeToken(["gateway:admin"]);
  const deleteRes = await fetch(`${BASE_URL}/servers/${encodeURIComponent(serverId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(deleteRes.status, 200);
  const deleteBody = await deleteRes.json();
  assert.equal(deleteBody.ok, true);
});

test("GET /servers/:id/tools returns 404 for unknown server and 503 for missing upstream env", async () => {
  const missingServerRes = await fetch(`${BASE_URL}/servers/unknown-server/tools`);
  assert.equal(missingServerRes.status, 404);

  const serverId = `server-tools-${Date.now()}`;
  const createRes = await addServer(serverId, {
    upstream_token_env: "MISSING_VENDOR_TOKEN",
  });
  assert.equal(createRes.status, 201);

  const toolsRes = await fetch(`${BASE_URL}/servers/${encodeURIComponent(serverId)}/tools`);
  assert.equal(toolsRes.status, 503);
  const toolsBody = await toolsRes.json();
  assert.match(String(toolsBody.error ?? ""), /MISSING_VENDOR_TOKEN/);
});

test("POST /:serverId/mcp tools/call rejects missing bearer", async () => {
  const res = await fetch(`${BASE_URL}/flight/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "missing-bearer-server-route",
      method: "tools/call",
      params: { name: "search_flights_tool", arguments: { from: "SEA", to: "SFO" } },
    }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, "missing-bearer-server-route");
  assert.match(
    String(body?.error?.message ?? ""),
    /(missing bearer token|jwt validation failed)/i,
  );
});

test("GET /pending/:id requires poll token and accepts valid poll token", async () => {
  const { pendingId, pendingPollToken } = await createPendingRequest();

  const noTokenRes = await fetch(`${BASE_URL}/pending/${encodeURIComponent(pendingId)}`);
  assert.equal(noTokenRes.status, 401);

  const withPollTokenRes = await fetch(`${BASE_URL}/pending/${encodeURIComponent(pendingId)}`, {
    headers: {
      "X-Pending-Token": pendingPollToken,
    },
  });
  assert.equal(withPollTokenRes.status, 200);
  const pollBody = await withPollTokenRes.json();
  assert.equal(pollBody.pending.id, pendingId);

  const adminToken = await makeToken(["gateway:admin"]);
  const withAdminRes = await fetch(`${BASE_URL}/pending/${encodeURIComponent(pendingId)}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(withAdminRes.status, 200);
});

test("GET /pending requires admin bearer when control plane auth is enabled", async () => {
  const noBearer = await fetch(`${BASE_URL}/pending`);
  assert.equal(noBearer.status, 401);

  const adminToken = await makeToken(["gateway:admin"]);
  const withAdmin = await fetch(`${BASE_URL}/pending`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(withAdmin.status, 200);
  const body = await withAdmin.json();
  assert.ok(Array.isArray(body.pending));
});

test("POST /pending/:id/approve requires admin bearer", async () => {
  const { pendingId } = await createPendingRequest();

  const noBearer = await fetch(`${BASE_URL}/pending/${encodeURIComponent(pendingId)}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ resolvedBy: "tester-no-bearer" }),
  });
  assert.equal(noBearer.status, 401);

  const adminToken = await makeToken(["gateway:admin"]);
  const withAdmin = await fetch(`${BASE_URL}/pending/${encodeURIComponent(pendingId)}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ resolvedBy: "tester-admin" }),
  });
  assert.equal(withAdmin.status, 200);
  const body = await withAdmin.json();
  assert.equal(body.pending.id, pendingId);
  assert.equal(body.pending.status, "approved");
  assert.ok(typeof body.approval_token === "string" && body.approval_token.length > 0);
});

test("OPTIONS /pending/:id preflight allows X-Pending-Token header", async () => {
  const { pendingId } = await createPendingRequest();
  const preflightRes = await fetch(`${BASE_URL}/pending/${encodeURIComponent(pendingId)}`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:5173",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "x-pending-token",
    },
  });
  assert.equal(preflightRes.status, 204);

  const allowHeaders = preflightRes.headers.get("access-control-allow-headers") ?? "";
  const normalizedAllowHeaders = allowHeaders.toLowerCase();
  assert.ok(normalizedAllowHeaders.includes("x-pending-token"));

  const allowOrigin = preflightRes.headers.get("access-control-allow-origin") ?? "";
  assert.ok(allowOrigin === "*" || allowOrigin === "http://127.0.0.1:5173");
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { after, test } from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { ToolGuard } from "../dist/index.js";

const ISSUER = "https://issuer.example";
const AUDIENCE = "mcp-tool-guard";

const serversToClose = [];

after(async () => {
  await Promise.all(
    serversToClose.map(
      (server) =>
        new Promise((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function startJwksServer(jwk) {
  const body = JSON.stringify({ keys: [jwk] });
  const server = createServer((req, res) => {
    if (req.url !== "/.well-known/jwks.json") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  serversToClose.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind JWKS test server");
  }
  return `http://127.0.0.1:${address.port}/.well-known/jwks.json`;
}

function makeConfig() {
  return {
    servers: {
      github: {
        url: "https://example.com/mcp",
        tools: {
          search_repositories: {
            required_scope: "repo:read",
          },
        },
      },
    },
  };
}

test("JWKS M2M-shaped token is rejected when agent record is missing (without gty)", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.use = "sig";
  jwk.alg = "RS256";
  jwk.kid = "revocation-test";
  const jwksUrl = await startJwksServer(jwk);

  const guard = new ToolGuard({
    config: makeConfig(),
    isM2mClientActive: async () => false,
    jwtIssuer: ISSUER,
    jwtAudience: AUDIENCE,
    jwksUrl,
  });

  const token = await new SignJWT({
    scope: "repo:read",
    sub: "deleted-client@clients",
  })
    .setProtectedHeader({ alg: "RS256", kid: "revocation-test" })
    .setIssuer(`${ISSUER}/`)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

  const result = await guard.authorize("github", "search_repositories", token);
  assert.equal(result.allowed, false);
  assert.match(String(result.reason ?? ""), /Agent revoked or deleted/i);
});

test("JWKS human token without agent record still validates", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.use = "sig";
  jwk.alg = "RS256";
  jwk.kid = "human-test";
  const jwksUrl = await startJwksServer(jwk);

  const guard = new ToolGuard({
    config: makeConfig(),
    isM2mClientActive: async () => false,
    jwtIssuer: ISSUER,
    jwtAudience: AUDIENCE,
    jwksUrl,
  });

  const token = await new SignJWT({
    scope: "repo:read",
    sub: "auth0|operator-user",
  })
    .setProtectedHeader({ alg: "RS256", kid: "human-test" })
    .setIssuer(`${ISSUER}/`)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

  const result = await guard.authorize("github", "search_repositories", token);
  assert.equal(result.allowed, true);
});

test("JWKS token with gty but no client_id/sub@clients is rejected", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.use = "sig";
  jwk.alg = "RS256";
  jwk.kid = "gty-shape-test";
  const jwksUrl = await startJwksServer(jwk);

  const guard = new ToolGuard({
    config: makeConfig(),
    jwtIssuer: ISSUER,
    jwtAudience: AUDIENCE,
    jwksUrl,
  });

  const token = await new SignJWT({
    scope: "repo:read",
    gty: "client-credentials",
    sub: "auth0|not-a-client-sub",
  })
    .setProtectedHeader({ alg: "RS256", kid: "gty-shape-test" })
    .setIssuer(`${ISSUER}/`)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

  const result = await guard.authorize("github", "search_repositories", token);
  assert.equal(result.allowed, false);
  assert.match(String(result.reason ?? ""), /M2M token missing client_id\/sub claim shape/i);
});

test("Entra-shaped M2M token (azp, roles, no client_id/@clients sub) is detected as M2M-like and hits the revocation check", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.use = "sig";
  jwk.alg = "RS256";
  jwk.kid = "entra-m2m-test";
  const jwksUrl = await startJwksServer(jwk);

  const guard = new ToolGuard({
    config: makeConfig(),
    isM2mClientActive: async () => false,
    jwtIssuer: ISSUER,
    jwtAudience: AUDIENCE,
    jwksUrl,
  });

  const token = await new SignJWT({
    roles: ["repo:read"],
    azp: "entra-app-client-id",
    sub: "entra-app-client-id", // Entra v2 M2M tokens set sub = azp, not "<id>@clients"
  })
    .setProtectedHeader({ alg: "RS256", kid: "entra-m2m-test" })
    .setIssuer(`${ISSUER}/`)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

  const result = await guard.authorize("github", "search_repositories", token);
  assert.equal(result.allowed, false);
  assert.match(String(result.reason ?? ""), /Agent revoked or deleted/i);
});

test("Entra-shaped M2M token with only appid (v1 shape) is also detected as M2M-like", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.use = "sig";
  jwk.alg = "RS256";
  jwk.kid = "entra-v1-m2m-test";
  const jwksUrl = await startJwksServer(jwk);

  const guard = new ToolGuard({
    config: makeConfig(),
    isM2mClientActive: async () => true,
    jwtIssuer: ISSUER,
    jwtAudience: AUDIENCE,
    jwksUrl,
  });

  const token = await new SignJWT({
    roles: ["repo:read"],
    appid: "entra-app-client-id-v1",
    sub: "some-object-id",
  })
    .setProtectedHeader({ alg: "RS256", kid: "entra-v1-m2m-test" })
    .setIssuer(`${ISSUER}/`)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

  const result = await guard.authorize("github", "search_repositories", token);
  assert.equal(result.allowed, true);
});

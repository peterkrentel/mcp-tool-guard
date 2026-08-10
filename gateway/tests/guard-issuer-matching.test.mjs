import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { after, test } from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { ToolGuard } from "../dist/index.js";

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

// Regression test for a real bug hit against a live Entra tenant: guard.ts's
// validateToken() used to hardcode `issuer: \`${this.jwtIssuer}/\`` (a trailing
// slash) when calling jose's jwtVerify(), which matches Auth0's real `iss`
// shape (`https://tenant.auth0.com/`) but not Entra's
// (`https://login.microsoftonline.com/<tenant>/v2.0`, no trailing slash) —
// every Entra token failed with "unexpected iss claim value" even though the
// earlier issMatches() gate had already confirmed the issuer was trusted.
test("JWKS token with a no-trailing-slash issuer (Entra shape) validates correctly", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.use = "sig";
  jwk.alg = "RS256";
  jwk.kid = "entra-shape-test";
  const jwksUrl = await startJwksServer(jwk);

  const issuer = "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0";

  const guard = new ToolGuard({
    config: makeConfig(),
    jwtIssuer: issuer,
    jwtAudience: AUDIENCE,
    jwksUrl,
  });

  const token = await new SignJWT({ roles: ["repo:read"] })
    .setProtectedHeader({ alg: "RS256", kid: "entra-shape-test" })
    .setIssuer(issuer) // no trailing slash — the real Entra shape
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

  const result = await guard.authorize("github", "search_repositories", token);
  assert.equal(result.allowed, true, `expected allow, got: ${result.reason}`);
});

test("JWKS token with a trailing-slash issuer (Auth0 shape) still validates correctly", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.use = "sig";
  jwk.alg = "RS256";
  jwk.kid = "auth0-shape-test";
  const jwksUrl = await startJwksServer(jwk);

  const issuer = "https://tenant.auth0.com"; // stored/normalized form, no trailing slash

  const guard = new ToolGuard({
    config: makeConfig(),
    jwtIssuer: issuer,
    jwtAudience: AUDIENCE,
    jwksUrl,
  });

  const token = await new SignJWT({ permissions: ["repo:read"] })
    .setProtectedHeader({ alg: "RS256", kid: "auth0-shape-test" })
    .setIssuer(`${issuer}/`) // real Auth0 tokens carry the trailing slash
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

  const result = await guard.authorize("github", "search_repositories", token);
  assert.equal(result.allowed, true, `expected allow, got: ${result.reason}`);
});

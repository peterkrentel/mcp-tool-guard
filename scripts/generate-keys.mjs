import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, importPKCS8 } from "jose";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const keysDir = join(root, "keys");
const uiPublic = join(root, "ui", "public");

mkdirSync(keysDir, { recursive: true });
mkdirSync(uiPublic, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

writeFileSync(join(keysDir, "demo-public.pem"), publicKey);
writeFileSync(join(keysDir, "demo-private.pem"), privateKey);
writeFileSync(join(uiPublic, "demo-public.pem"), publicKey);

const pk = await importPKCS8(privateKey, "RS256");
const now = Math.floor(Date.now() / 1000);
const exp = now + 60 * 60 * 24 * 365;

async function mint(scopes, label) {
  return new SignJWT({ scope: scopes.join(" "), label })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject("demo-user")
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(pk);
}

const tokens = {
  read_only: await mint(["flights:read"], "read-only"),
  booking: await mint(["flights:read", "flights:write"], "booking"),
  admin: await mint(["flights:read", "flights:write", "flights:delete"], "admin"),
};

writeFileSync(join(uiPublic, "demo-tokens.json"), JSON.stringify(tokens, null, 2));

console.log("Generated demo keys and tokens:");
console.log("  keys/demo-public.pem");
console.log("  keys/demo-private.pem");
console.log("  ui/public/demo-public.pem");
console.log("  ui/public/demo-tokens.json");

#!/usr/bin/env node
/**
 * Demo-only: embedded guards must match gateway/config.yaml per owned server.
 * Canonical policy is gateway/config.yaml; guard_config.yaml goes away with guard proxy (#12).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEMO_SERVERS = [
  { id: "flight", guardPath: "servers/flight/guard_config.yaml" },
  { id: "documents", guardPath: "servers/documents/guard_config.yaml" },
];

function toolPolicy(tools) {
  const out = {};
  for (const [name, cfg] of Object.entries(tools ?? {})) {
    out[name] = {
      required_scope: cfg.required_scope,
      alert: Boolean(cfg.alert),
      log_level: cfg.log_level ?? "info",
    };
  }
  return JSON.stringify(out, Object.keys(out).sort());
}

const gateway = parse(readFileSync(join(root, "gateway/config.yaml"), "utf8"));

for (const { id, guardPath } of DEMO_SERVERS) {
  const gatewayTools = gateway?.servers?.[id]?.tools;
  const demoYaml = parse(readFileSync(join(root, guardPath), "utf8"));
  const demoTools = demoYaml?.tools;

  if (!gatewayTools) {
    console.error(`::error::gateway/config.yaml missing servers.${id}.tools`);
    process.exit(1);
  }
  if (!demoTools) {
    console.error(`::error::${guardPath} missing tools`);
    process.exit(1);
  }

  const a = toolPolicy(gatewayTools);
  const b = toolPolicy(demoTools);

  if (a !== b) {
    console.error(
      `::error::Demo policy drift: ${guardPath} must match gateway/config.yaml servers.${id}.tools (until #12 proxy).`,
    );
    console.error("Gateway:", a);
    console.error("Demo:   ", b);
    process.exit(1);
  }

  console.log(`Demo policy aligned: gateway ${id} == ${guardPath}`);
}

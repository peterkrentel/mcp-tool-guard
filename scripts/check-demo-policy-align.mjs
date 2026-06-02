#!/usr/bin/env node
/**
 * Demo-only: flight embedded guard must match gateway/config.yaml → servers.flight.tools.
 * Canonical policy is gateway/config.yaml; guard_config.yaml goes away with guard proxy (#12).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
const flightYaml = parse(readFileSync(join(root, "servers/flight/guard_config.yaml"), "utf8"));

const gatewayTools = gateway?.servers?.flight?.tools;
const demoTools = flightYaml?.tools;

if (!gatewayTools) {
  console.error("::error::gateway/config.yaml missing servers.flight.tools");
  process.exit(1);
}
if (!demoTools) {
  console.error("::error::servers/flight/guard_config.yaml missing tools");
  process.exit(1);
}

const a = toolPolicy(gatewayTools);
const b = toolPolicy(demoTools);

if (a !== b) {
  console.error(
    "::error::Demo policy drift: servers/flight/guard_config.yaml must match gateway/config.yaml servers.flight.tools (until #12 proxy removes embedded guard).",
  );
  console.error("Gateway:", a);
  console.error("Flight: ", b);
  process.exit(1);
}

console.log("Demo policy aligned: gateway/config.yaml flight tools == guard_config.yaml");

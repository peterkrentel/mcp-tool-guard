import type { GuardConfig } from "@mcp-tool-guard/gateway";
import { parse } from "yaml";

import gatewayPolicyYaml from "../../gateway/config.yaml?raw";
import { DEMO_SERVER_IDS, type DemoServerId } from "./servers.js";

const BROWSER_MCP_PATHS: Record<DemoServerId, string> = {
  flight: "/mcp",
  documents: "/documents/mcp",
};

/** Client guard policy — loaded from [gateway/config.yaml](../../gateway/config.yaml). */
function loadGuardConfig(): GuardConfig {
  const parsed = parse(gatewayPolicyYaml) as GuardConfig;
  const servers = { ...parsed.servers };

  for (const serverId of DEMO_SERVER_IDS) {
    const server = servers[serverId];
    if (!server?.tools) {
      throw new Error(`gateway/config.yaml: missing servers.${serverId}.tools`);
    }
    servers[serverId] = {
      ...server,
      url: BROWSER_MCP_PATHS[serverId],
    };
  }

  return { ...parsed, servers };
}

export const GUARD_CONFIG = loadGuardConfig();

/** Demo LLM hints only — not security policy (see gateway/config.yaml). */
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  search_flights_tool:
    "Search flights — required: origin, destination (IATA codes). Optional: departure_date (YYYY-MM-DD, only if user provided)",
  get_flight_details: "Get details — required: flight_id (e.g. FL101)",
  create_booking_tool:
    "Book — required: flight_id, passenger_name, passenger_email",
  get_booking_tool: "Get booking — required: booking_id",
  cancel_booking_tool:
    "Cancel/delete booking — required: booking_id (BK-...); cannot delete flights from schedule",
  modify_booking_tool:
    "Modify — required: booking_id; optional: passenger_name, passenger_email",
  check_in_tool: "Check in — required: booking_id",
  select_seats_tool: "Select seat — required: booking_id, seat",
  add_baggage_tool: "Add baggage — required: booking_id, baggage_kg",
  track_flight_tool: "Track — required: flight_id",
  list_documents_tool: "List internal documents (policy, runbooks)",
  get_document_tool: "Get document — required: doc_id (e.g. DOC-42)",
  search_documents_tool: "Search documents — required: query keyword",
  publish_document_tool:
    "Publish or update — required: title, body; optional: doc_id to update",
  archive_document_tool: "Archive document — required: doc_id (DOC-...)",
};

import type { GuardConfig } from "@mcp-tool-guard/gateway";

export const GUARD_CONFIG: GuardConfig = {
  servers: {
    flight: {
      url: "/mcp",
      tools: {
        search_flights_tool: { required_scope: "flights:read" },
        get_flight_details: { required_scope: "flights:read" },
        track_flight_tool: { required_scope: "flights:read" },
        create_booking_tool: { required_scope: "flights:write" },
        get_booking_tool: { required_scope: "flights:read" },
        modify_booking_tool: { required_scope: "flights:write" },
        check_in_tool: { required_scope: "flights:write" },
        select_seats_tool: { required_scope: "flights:write" },
        add_baggage_tool: { required_scope: "flights:write" },
        cancel_booking_tool: {
          required_scope: "flights:delete",
          alert: true,
          log_level: "verbose",
        },
      },
    },
  },
};

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  search_flights_tool:
    "Search flights — required: origin, destination (IATA codes). Optional: departure_date (YYYY-MM-DD, only if user provided)",
  get_flight_details: "Get details — required: flight_id (e.g. FL101)",
  create_booking_tool:
    "Book — required: flight_id, passenger_name, passenger_email",
  get_booking_tool: "Get booking — required: booking_id",
      cancel_booking_tool: "Cancel/delete booking — required: booking_id (BK-...); cannot delete flights from schedule",
  modify_booking_tool: "Modify — required: booking_id; optional: passenger_name, passenger_email",
  check_in_tool: "Check in — required: booking_id",
  select_seats_tool: "Select seat — required: booking_id, seat",
  add_baggage_tool: "Add baggage — required: booking_id, baggage_kg",
  track_flight_tool: "Track — required: flight_id",
};

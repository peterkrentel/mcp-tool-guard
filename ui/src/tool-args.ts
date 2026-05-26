export interface ToolCallIntent {
  tool: string;
  arguments: Record<string, unknown>;
}

/** Demo flights use June 2026 departures. */
export const DEMO_DATES_HINT = "2026-06-01 through 2026-06-04";

export type PreparedToolCall =
  | {
      ok: true;
      tool: string;
      arguments: Record<string, unknown>;
      /** Shown in status bar — what was actually sent to MCP. */
      summary: string;
    }
  | {
      ok: false;
      message: string;
      pending: PendingToolCall;
    };

export interface PendingToolCall {
  tool: string;
  partial: Record<string, unknown>;
  missing: string[];
}

const IATA = /\b([A-Z]{3})\b/g;
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const FLIGHT_ID = /\b(FL\d+)\b/i;
const BOOKING_ID = /\b(BK-[A-Z0-9]+)\b/i;
const EMAIL = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/;

export function extractIataCodes(message: string): string[] {
  const upper = message.toUpperCase();
  const codes: string[] = [];
  for (const match of upper.matchAll(IATA)) {
    const code = match[1];
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

export function extractUserDate(message: string): string | undefined {
  return message.match(ISO_DATE)?.[1];
}

/** Detect common flight search phrasing without calling the LLM. */
export function tryHeuristicIntent(userMessage: string): ToolCallIntent | null {
  const lower = userMessage.toLowerCase();

  if (/\b(search|find|list|show)\b.*\bflight/.test(lower) || /\bflight/.test(lower)) {
    const codes = extractIataCodes(userMessage);
    if (codes.length >= 2) {
      const args: Record<string, unknown> = {
        origin: codes[0],
        destination: codes[1],
      };
      const date = extractUserDate(userMessage);
      if (date) args.departure_date = date;
      return { tool: "search_flights_tool", arguments: args };
    }
  }

  if (/\bbook\b/.test(lower) && FLIGHT_ID.test(userMessage)) {
    const flightId = userMessage.match(FLIGHT_ID)?.[1]?.toUpperCase();
    const email = userMessage.match(EMAIL)?.[1];
    const nameMatch = userMessage.match(/\bfor\s+([^,]+?)(?:,|\s+\S+@)/i);
    const args: Record<string, unknown> = {};
    if (flightId) args.flight_id = flightId;
    if (nameMatch) args.passenger_name = nameMatch[1].trim();
    if (email) args.passenger_email = email;
    if (flightId) {
      return { tool: "create_booking_tool", arguments: args };
    }
  }

  if (/\bcancel\b/.test(lower) && BOOKING_ID.test(userMessage)) {
    return {
      tool: "cancel_booking_tool",
      arguments: { booking_id: userMessage.match(BOOKING_ID)?.[1] },
    };
  }

  if (/\b(track|status)\b/.test(lower) && FLIGHT_ID.test(userMessage)) {
    return {
      tool: "track_flight_tool",
      arguments: { flight_id: userMessage.match(FLIGHT_ID)?.[1]?.toUpperCase() },
    };
  }

  if (/\b(details|info)\b/.test(lower) && FLIGHT_ID.test(userMessage)) {
    return {
      tool: "get_flight_details",
      arguments: { flight_id: userMessage.match(FLIGHT_ID)?.[1]?.toUpperCase() },
    };
  }

  return null;
}

function mergePending(
  partial: Record<string, unknown>,
  userMessage: string,
): Record<string, unknown> {
  const merged = { ...partial };
  const codes = extractIataCodes(userMessage);
  if (!merged.origin && codes[0]) merged.origin = codes[0];
  if (!merged.destination && codes[1]) merged.destination = codes[1];
  const date = extractUserDate(userMessage);
  if (date) merged.departure_date = date;
  const flightId = userMessage.match(FLIGHT_ID)?.[1]?.toUpperCase();
  if (!merged.flight_id && flightId) merged.flight_id = flightId;
  const bookingId = userMessage.match(BOOKING_ID)?.[1];
  if (!merged.booking_id && bookingId) merged.booking_id = bookingId;
  const email = userMessage.match(EMAIL)?.[1];
  if (!merged.passenger_email && email) merged.passenger_email = email;
  if (!merged.passenger_name) {
    const nameMatch = userMessage.match(/\bfor\s+([^,]+?)(?:,|\s+\S+@)/i);
    if (nameMatch) merged.passenger_name = nameMatch[1].trim();
  }
  return merged;
}

function formatSummary(tool: string, args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return `${tool}(${parts.join(", ")})`;
}

function searchMissing(args: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!args.origin || typeof args.origin !== "string") missing.push("origin (3-letter airport code, e.g. SFO)");
  if (!args.destination || typeof args.destination !== "string") {
    missing.push("destination (3-letter airport code, e.g. JFK)");
  }
  return missing;
}

function sanitizeSearchArgs(
  userMessage: string,
  llmArgs: Record<string, unknown>,
): Record<string, unknown> {
  const codes = extractIataCodes(userMessage);
  const out: Record<string, unknown> = {};

  out.origin =
    codes[0] ?? (typeof llmArgs.origin === "string" ? llmArgs.origin.toUpperCase() : undefined);
  out.destination =
    codes[1] ??
    (typeof llmArgs.destination === "string" ? llmArgs.destination.toUpperCase() : undefined);

  const userDate = extractUserDate(userMessage);
  if (userDate) {
    out.departure_date = userDate;
  }
  // Never pass LLM-invented dates — only dates the user typed.

  return out;
}

export function prepareToolCall(
  tool: string,
  userMessage: string,
  llmArgs: Record<string, unknown>,
  pendingPartial?: Record<string, unknown>,
): PreparedToolCall {
  const base = pendingPartial ? mergePending(pendingPartial, userMessage) : { ...llmArgs };

  switch (tool) {
    case "search_flights_tool": {
      const args = sanitizeSearchArgs(userMessage, base);
      const missing = searchMissing(args);
      if (missing.length > 0) {
        return {
          ok: false,
          message: `To search flights I need:\n${missing.map((m) => `• ${m}`).join("\n")}\n\nExample: "Search flights from SFO to JFK"\nOptional date (only if you want to filter): YYYY-MM-DD (demo: ${DEMO_DATES_HINT})`,
          pending: { tool, partial: args, missing },
        };
      }
      const summary = formatSummary(tool, args);
      const droppedDate =
        typeof base.departure_date === "string" && !extractUserDate(userMessage);
      const note = droppedDate
        ? `${summary} — ignored invented departure_date; add a date in your message to filter`
        : summary;
      return { ok: true, tool, arguments: args, summary: note };
    }

    case "create_booking_tool": {
      const args = mergePending(base, userMessage);
      const missing: string[] = [];
      if (!args.flight_id) missing.push("flight_id (e.g. FL101)");
      if (!args.passenger_name) missing.push("passenger_name");
      if (!args.passenger_email) missing.push("passenger_email");
      if (missing.length > 0) {
        return {
          ok: false,
          message: `To book a flight I need:\n${missing.map((m) => `• ${m}`).join("\n")}\n\nExample: "Book FL101 for Jane Doe, jane@example.com"`,
          pending: { tool, partial: args, missing },
        };
      }
      return {
        ok: true,
        tool,
        arguments: {
          flight_id: String(args.flight_id).toUpperCase(),
          passenger_name: String(args.passenger_name),
          passenger_email: String(args.passenger_email),
        },
        summary: formatSummary(tool, args),
      };
    }

    case "cancel_booking_tool":
    case "get_booking_tool":
    case "check_in_tool":
    case "modify_booking_tool":
    case "select_seats_tool":
    case "add_baggage_tool": {
      const args = mergePending(base, userMessage);
      if (!args.booking_id) {
        return {
          ok: false,
          message: `I need a booking_id (e.g. BK-A1B2C3D4).`,
          pending: { tool, partial: args, missing: ["booking_id"] },
        };
      }
      return {
        ok: true,
        tool,
        arguments: { ...args, booking_id: String(args.booking_id) },
        summary: formatSummary(tool, args),
      };
    }

    case "get_flight_details":
    case "track_flight_tool": {
      const args = mergePending(base, userMessage);
      if (!args.flight_id) {
        return {
          ok: false,
          message: `I need a flight_id (e.g. FL101).`,
          pending: { tool, partial: args, missing: ["flight_id"] },
        };
      }
      return {
        ok: true,
        tool,
        arguments: { flight_id: String(args.flight_id).toUpperCase() },
        summary: formatSummary(tool, args),
      };
    }

    default:
      return { ok: true, tool, arguments: base, summary: formatSummary(tool, base) };
  }
}

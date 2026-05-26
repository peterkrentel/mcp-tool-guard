export interface ToolCallIntent {
  tool: string;
  arguments: Record<string, unknown>;
}

/** Demo flights use June 2026 departures. */
export const DEMO_DATES_HINT = "2026-06-01 through 2026-06-04";

export interface SessionContext {
  lastBookingId: string | null;
  lastFlightId: string | null;
}

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

export function extractBookingIdFromUser(message: string): string | undefined {
  return message.match(BOOKING_ID)?.[1];
}

function isFlightId(id: string): boolean {
  return /^FL\d+$/i.test(id.trim());
}

function isBookingId(id: string): boolean {
  return /^BK-[A-Z0-9]+$/i.test(id.trim());
}

/** Parse create_booking_tool MCP JSON to update session. */
export function extractBookingIdFromToolResult(
  tool: string,
  rawResult: string,
): { bookingId?: string; flightId?: string } {
  if (tool !== "create_booking_tool") return {};
  try {
    const parsed = JSON.parse(rawResult) as {
      success?: boolean;
      booking?: { booking_id?: string; flight_id?: string };
    };
    if (parsed.success && parsed.booking?.booking_id) {
      return {
        bookingId: parsed.booking.booking_id,
        flightId: parsed.booking.flight_id,
      };
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Reject fabricated cancel responses that are not from our MCP server shape. */
export function formatCancelToolResult(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      success?: boolean;
      booking?: { booking_id?: string; status?: string };
      error?: string;
      message?: string;
    };
    if (parsed.success === true && parsed.booking?.booking_id) {
      const b = parsed.booking;
      return `Booking ${b.booking_id} cancelled (status: ${b.status ?? "cancelled"}).`;
    }
    if (parsed.success === false && parsed.error) {
      return `Cancel failed: ${parsed.error}`;
    }
    if (parsed.message && !parsed.booking) {
      return (
        `⚠ This does not look like a real MCP cancel response (missing booking object).\n` +
        `Do not assume the booking was cancelled. Use: Cancel booking BK-XXXXXXXX`
      );
    }
  } catch {
    /* fall through */
  }
  return `⚠ Unparseable MCP response:\n${raw}`;
}

function wantsCancelLastBooking(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();
  return (
    /\b(cancel|void)\b/.test(lower) &&
    (/\b(my|the|that|this)\s+booking\b/.test(lower) ||
      /\bcancel\s+(it|that)\b/.test(lower) ||
      (/\bcancel\b/.test(lower) && !extractBookingIdFromUser(userMessage) && !FLIGHT_ID.test(userMessage)))
  );
}

function sanitizeCancelBookingArgs(
  userMessage: string,
  llmArgs: Record<string, unknown>,
  session: SessionContext,
): { ok: true; booking_id: string; summaryNote?: string } | { ok: false; message: string } {
  const fromUser = extractBookingIdFromUser(userMessage);
  if (fromUser) {
    return { ok: true, booking_id: fromUser };
  }

  const llmRaw =
    typeof llmArgs.booking_id === "string" ? llmArgs.booking_id.trim().toUpperCase() : undefined;

  if (llmRaw && isFlightId(llmRaw)) {
    const hint = session.lastBookingId
      ? ` Your last booking: ${session.lastBookingId}. Try: "Cancel booking ${session.lastBookingId}"`
      : "";
    return {
      ok: false,
      message:
        `Cannot cancel flight ${llmRaw} — cancel needs a booking ID (BK-...), not a flight ID (FL...).${hint}`,
    };
  }

  if (llmRaw && isBookingId(llmRaw) && !userMessage.toUpperCase().includes(llmRaw)) {
    const hint = session.lastBookingId
      ? ` Use the ID from your booking confirmation: ${session.lastBookingId}`
      : " Include the booking ID (BK-...) in your message.";
    return {
      ok: false,
      message: `I won't use booking ID ${llmRaw} unless you type it in your message.${hint}`,
    };
  }

  if (wantsCancelLastBooking(userMessage) && session.lastBookingId) {
    return {
      ok: true,
      booking_id: session.lastBookingId,
      summaryNote: `using last booking ${session.lastBookingId}`,
    };
  }

  const lower = userMessage.toLowerCase();
  if (/\b(cancel|void)\b/.test(lower)) {
    const hint = session.lastBookingId
      ? `\n\nYour last booking: ${session.lastBookingId}\nExample: "Cancel booking ${session.lastBookingId}"`
      : '\n\nExample: "Cancel booking BK-XXXXXXXX" (from your booking confirmation)';
    const flightHint =
      FLIGHT_ID.test(userMessage) && !fromUser
        ? "\n\nNote: FL101 is a flight ID, not a booking ID."
        : "";
    return {
      ok: false,
      message: `To cancel I need a booking ID (BK-...) in your message.${flightHint}${hint}`,
    };
  }

  return { ok: false, message: "I need a booking_id (e.g. BK-A1B2C3D4)." };
}

function sanitizeBookingIdArgs(
  userMessage: string,
  llmArgs: Record<string, unknown>,
  session: SessionContext,
): { ok: true; booking_id: string } | { ok: false; message: string } {
  const fromUser = extractBookingIdFromUser(userMessage);
  if (fromUser) return { ok: true, booking_id: fromUser };

  const llmRaw =
    typeof llmArgs.booking_id === "string" ? llmArgs.booking_id.trim().toUpperCase() : undefined;
  if (llmRaw && isFlightId(llmRaw)) {
    return {
      ok: false,
      message: `Booking tools need a booking ID (BK-...), not flight ${llmRaw}.`,
    };
  }

  if (wantsCancelLastBooking(userMessage) && session.lastBookingId) {
    return { ok: true, booking_id: session.lastBookingId };
  }

  if (session.lastBookingId && /\b(my|the|that)\s+booking\b/i.test(userMessage)) {
    return { ok: true, booking_id: session.lastBookingId };
  }

  return { ok: false, message: "I need a booking_id (e.g. BK-A1B2C3D4) in your message." };
}

/** Detect common flight phrasing without calling the LLM. */
export function tryHeuristicIntent(
  userMessage: string,
  session: SessionContext,
): ToolCallIntent | null {
  const lower = userMessage.toLowerCase();

  if (/\b(cancel|void)\b/.test(lower)) {
    const bk = extractBookingIdFromUser(userMessage);
    return { tool: "cancel_booking_tool", arguments: bk ? { booking_id: bk } : {} };
  }

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
  const bookingId = extractBookingIdFromUser(userMessage);
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

  return out;
}

export function prepareToolCall(
  tool: string,
  userMessage: string,
  llmArgs: Record<string, unknown>,
  pendingPartial?: Record<string, unknown>,
  session: SessionContext = { lastBookingId: null, lastFlightId: null },
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

    case "cancel_booking_tool": {
      const resolved = sanitizeCancelBookingArgs(userMessage, base, session);
      if (!resolved.ok) {
        return {
          ok: false,
          message: resolved.message,
          pending: { tool, partial: {}, missing: ["booking_id"] },
        };
      }
      const summary = resolved.summaryNote
        ? `cancel_booking_tool(booking_id=${JSON.stringify(resolved.booking_id)}, ${resolved.summaryNote})`
        : formatSummary(tool, { booking_id: resolved.booking_id });
      return {
        ok: true,
        tool,
        arguments: { booking_id: resolved.booking_id },
        summary,
      };
    }

    case "get_booking_tool":
    case "check_in_tool":
    case "modify_booking_tool":
    case "select_seats_tool":
    case "add_baggage_tool": {
      const resolved = sanitizeBookingIdArgs(userMessage, base, session);
      if (!resolved.ok) {
        return {
          ok: false,
          message: resolved.message,
          pending: { tool, partial: {}, missing: ["booking_id"] },
        };
      }
      const args = { ...mergePending(base, userMessage), booking_id: resolved.booking_id };
      return {
        ok: true,
        tool,
        arguments: args,
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

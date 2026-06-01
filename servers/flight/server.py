"""Flight MCP server — mock airline booking tools for MCPToolGuard demos."""

from __future__ import annotations

import json
import os
from typing import Any

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from mock_data import (
    add_baggage,
    cancel_booking,
    check_in,
    create_booking,
    find_flight,
    get_booking,
    modify_booking,
    search_flights,
    select_seats,
    track_flight,
)
from guard import FlightToolGuard
from guard_middleware import JwtToolGuardMiddleware

_guard: FlightToolGuard | None = None


def get_guard() -> FlightToolGuard:
    global _guard
    if _guard is None:
        _guard = FlightToolGuard.load()
    return _guard

mcp = FastMCP(
    "Flight MCP",
    instructions=(
        "Mock airline booking server for MCPToolGuard demos. "
        "Search flights, manage bookings, check in, and track flights."
    ),
)


def _json(data: Any) -> str:
    return json.dumps(data, indent=2)


@mcp.tool()
def search_flights_tool(
    origin: str | None = None,
    destination: str | None = None,
    departure_date: str | None = None,
) -> str:
    """Search available flights by origin, destination, and optional departure date (YYYY-MM-DD)."""
    results = search_flights(origin=origin, destination=destination, departure_date=departure_date)
    return _json({"count": len(results), "flights": results})


@mcp.tool()
def get_flight_details(flight_id: str) -> str:
    """Get detailed information for a specific flight by its ID (e.g. FL101)."""
    flight = find_flight(flight_id)
    if not flight:
        return _json({"error": f"Flight {flight_id} not found"})
    return _json(flight)


@mcp.tool()
def create_booking_tool(
    flight_id: str,
    passenger_name: str,
    passenger_email: str,
) -> str:
    """Create a new flight booking for a passenger on the specified flight."""
    try:
        booking = create_booking(flight_id, passenger_name, passenger_email)
        return _json({"success": True, "booking": booking})
    except ValueError as exc:
        return _json({"success": False, "error": str(exc)})


@mcp.tool()
def get_booking_tool(booking_id: str) -> str:
    """Retrieve booking details by booking ID (e.g. BK-A1B2C3D4)."""
    booking = get_booking(booking_id)
    if not booking:
        return _json({"error": f"Booking {booking_id} not found"})
    return _json(booking)


@mcp.tool()
def cancel_booking_tool(booking_id: str) -> str:
    """Cancel an existing booking. Requires elevated delete scope in MCPToolGuard."""
    try:
        booking = cancel_booking(booking_id)
        return _json({"success": True, "booking": booking})
    except ValueError as exc:
        return _json({"success": False, "error": str(exc)})


@mcp.tool()
def modify_booking_tool(
    booking_id: str,
    passenger_name: str | None = None,
    passenger_email: str | None = None,
) -> str:
    """Modify passenger details on an existing booking."""
    try:
        booking = modify_booking(booking_id, passenger_name, passenger_email)
        return _json({"success": True, "booking": booking})
    except ValueError as exc:
        return _json({"success": False, "error": str(exc)})


@mcp.tool()
def check_in_tool(booking_id: str) -> str:
    """Check in a passenger for their flight and assign a seat if none selected."""
    try:
        booking = check_in(booking_id)
        return _json({"success": True, "booking": booking})
    except ValueError as exc:
        return _json({"success": False, "error": str(exc)})


@mcp.tool()
def select_seats_tool(booking_id: str, seat: str) -> str:
    """Select or change the seat for a booking (e.g. 12A)."""
    try:
        booking = select_seats(booking_id, seat)
        return _json({"success": True, "booking": booking})
    except ValueError as exc:
        return _json({"success": False, "error": str(exc)})


@mcp.tool()
def add_baggage_tool(booking_id: str, baggage_kg: int) -> str:
    """Add checked baggage weight (kg) to a booking."""
    try:
        booking = add_baggage(booking_id, baggage_kg)
        return _json({"success": True, "booking": booking})
    except ValueError as exc:
        return _json({"success": False, "error": str(exc)})


@mcp.tool()
def track_flight_tool(flight_id: str) -> str:
    """Track real-time status and phase of a flight."""
    try:
        status = track_flight(flight_id)
        return _json(status)
    except ValueError as exc:
        return _json({"error": str(exc)})


@mcp.custom_route("/health", methods=["GET"])
async def health_check(_request: Request) -> JSONResponse:
    guard = get_guard()
    body: dict[str, Any] = {
        "status": "healthy",
        "service": "flight-mcp",
        "guard_enabled": guard.enabled,
        "jwt_trust_enabled": guard.jwt_trust.enabled,
    }
    if not guard.enabled:
        body["warning"] = (
            "MCP_GUARD_ENABLED=false — JWT enforcement disabled; not safe for production"
        )
    return JSONResponse(body)


@mcp.custom_route("/audit", methods=["GET"])
async def audit_log(request: Request) -> JSONResponse:
    """Recent server-side allow/deny entries (in-memory; resets on cold start)."""
    guard = get_guard()
    if guard.enabled:
        bearer = FlightToolGuard.extract_bearer(request.headers.get("authorization"))
        validation = guard.validate_token(bearer)
        if not validation.ok:
            return JSONResponse(
                {"error": validation.reason or "Unauthorized"},
                status_code=401,
            )

    session_id = request.query_params.get("session_id")
    return JSONResponse({"entries": guard.recent_audit(session_id=session_id)})


# CORS: demo UI + local Vite. Override with MCP_CORS_ORIGINS (comma-separated) or "*".
_DEFAULT_CORS_ORIGINS = (
    "https://mcp-tool-guard-ui.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


def _cors_allow_origins() -> list[str]:
    raw = os.environ.get("MCP_CORS_ORIGINS", "").strip()
    if raw == "*":
        return ["*"]
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    return list(_DEFAULT_CORS_ORIGINS)


# ASGI app for Vercel / uvicorn (stateless for serverless)
CORS = Middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Mcp-Session-Id", "X-Trace-Id", "X-Session-Id"],
)


def create_app(mcp_path: str = "/mcp"):
    base = mcp.http_app(path=mcp_path, stateless_http=True, middleware=[CORS])
    return JwtToolGuardMiddleware(base, get_guard())


app = create_app("/mcp")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(create_app("/mcp"), host="0.0.0.0", port=8000)

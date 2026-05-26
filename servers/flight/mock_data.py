"""Mock flight data for standalone MCP server demos."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
import uuid

# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

FLIGHTS: list[dict[str, Any]] = [
    {
        "flight_id": "FL101",
        "airline": "SkyGuard Airways",
        "origin": "SFO",
        "destination": "JFK",
        "departure": "2026-06-01T08:00:00",
        "arrival": "2026-06-01T16:30:00",
        "price_usd": 349.0,
        "seats_available": 42,
        "status": "scheduled",
    },
    {
        "flight_id": "FL202",
        "airline": "SkyGuard Airways",
        "origin": "SFO",
        "destination": "ORD",
        "departure": "2026-06-01T10:15:00",
        "arrival": "2026-06-01T16:45:00",
        "price_usd": 219.0,
        "seats_available": 18,
        "status": "scheduled",
    },
    {
        "flight_id": "FL303",
        "airline": "Pacific Jet",
        "origin": "LAX",
        "destination": "SEA",
        "departure": "2026-06-02T07:30:00",
        "arrival": "2026-06-02T10:15:00",
        "price_usd": 159.0,
        "seats_available": 55,
        "status": "scheduled",
    },
    {
        "flight_id": "FL404",
        "airline": "Pacific Jet",
        "origin": "SEA",
        "destination": "JFK",
        "departure": "2026-06-03T09:00:00",
        "arrival": "2026-06-03T17:20:00",
        "price_usd": 289.0,
        "seats_available": 31,
        "status": "scheduled",
    },
    {
        "flight_id": "FL505",
        "airline": "SkyGuard Airways",
        "origin": "JFK",
        "destination": "MIA",
        "departure": "2026-06-04T14:00:00",
        "arrival": "2026-06-04T17:10:00",
        "price_usd": 199.0,
        "seats_available": 27,
        "status": "scheduled",
    },
]

# In-memory booking store (resets on server restart)
BOOKINGS: dict[str, dict[str, Any]] = {}


@dataclass
class Booking:
    booking_id: str
    flight_id: str
    passenger_name: str
    passenger_email: str
    seat: str | None = None
    baggage_kg: int = 0
    status: str = "confirmed"
    checked_in: bool = False
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> dict[str, Any]:
        return {
            "booking_id": self.booking_id,
            "flight_id": self.flight_id,
            "passenger_name": self.passenger_name,
            "passenger_email": self.passenger_email,
            "seat": self.seat,
            "baggage_kg": self.baggage_kg,
            "status": self.status,
            "checked_in": self.checked_in,
            "created_at": self.created_at,
        }


def find_flight(flight_id: str) -> dict[str, Any] | None:
    return next((f for f in FLIGHTS if f["flight_id"] == flight_id), None)


def search_flights(
    origin: str | None = None,
    destination: str | None = None,
    departure_date: str | None = None,
) -> list[dict[str, Any]]:
    results = FLIGHTS
    if origin:
        results = [f for f in results if f["origin"].upper() == origin.upper()]
    if destination:
        results = [f for f in results if f["destination"].upper() == destination.upper()]
    if departure_date:
        results = [
            f
            for f in results
            if f["departure"].startswith(departure_date)
        ]
    return results


def create_booking(
    flight_id: str,
    passenger_name: str,
    passenger_email: str,
) -> dict[str, Any]:
    flight = find_flight(flight_id)
    if not flight:
        raise ValueError(f"Flight {flight_id} not found")
    if flight["seats_available"] <= 0:
        raise ValueError(f"No seats available on flight {flight_id}")

    booking_id = f"BK-{uuid.uuid4().hex[:8].upper()}"
    booking = Booking(
        booking_id=booking_id,
        flight_id=flight_id,
        passenger_name=passenger_name,
        passenger_email=passenger_email,
    )
    BOOKINGS[booking_id] = booking.to_dict()
    flight["seats_available"] -= 1
    return booking.to_dict()


def get_booking(booking_id: str) -> dict[str, Any] | None:
    return BOOKINGS.get(booking_id)


def cancel_booking(booking_id: str) -> dict[str, Any]:
    booking = BOOKINGS.get(booking_id)
    if not booking:
        raise ValueError(f"Booking {booking_id} not found")
    if booking["status"] == "cancelled":
        raise ValueError(f"Booking {booking_id} is already cancelled")

    flight = find_flight(booking["flight_id"])
    if flight:
        flight["seats_available"] += 1

    booking["status"] = "cancelled"
    return booking


def modify_booking(
    booking_id: str,
    passenger_name: str | None = None,
    passenger_email: str | None = None,
) -> dict[str, Any]:
    booking = BOOKINGS.get(booking_id)
    if not booking:
        raise ValueError(f"Booking {booking_id} not found")
    if booking["status"] == "cancelled":
        raise ValueError(f"Cannot modify cancelled booking {booking_id}")

    if passenger_name:
        booking["passenger_name"] = passenger_name
    if passenger_email:
        booking["passenger_email"] = passenger_email
    return booking


def check_in(booking_id: str) -> dict[str, Any]:
    booking = BOOKINGS.get(booking_id)
    if not booking:
        raise ValueError(f"Booking {booking_id} not found")
    if booking["status"] == "cancelled":
        raise ValueError(f"Cannot check in cancelled booking {booking_id}")
    if booking["checked_in"]:
        raise ValueError(f"Booking {booking_id} is already checked in")

    booking["checked_in"] = True
    if not booking["seat"]:
        booking["seat"] = f"{chr(65 + len(BOOKINGS) % 26)}{len(BOOKINGS) % 30 + 1}"
    return booking


def select_seats(booking_id: str, seat: str) -> dict[str, Any]:
    booking = BOOKINGS.get(booking_id)
    if not booking:
        raise ValueError(f"Booking {booking_id} not found")
    if booking["status"] == "cancelled":
        raise ValueError(f"Cannot select seat for cancelled booking {booking_id}")

    booking["seat"] = seat.upper()
    return booking


def add_baggage(booking_id: str, baggage_kg: int) -> dict[str, Any]:
    booking = BOOKINGS.get(booking_id)
    if not booking:
        raise ValueError(f"Booking {booking_id} not found")
    if booking["status"] == "cancelled":
        raise ValueError(f"Cannot add baggage to cancelled booking {booking_id}")
    if baggage_kg < 0:
        raise ValueError("Baggage weight must be non-negative")

    booking["baggage_kg"] += baggage_kg
    return booking


def track_flight(flight_id: str) -> dict[str, Any]:
    flight = find_flight(flight_id)
    if not flight:
        raise ValueError(f"Flight {flight_id} not found")

    departure = datetime.fromisoformat(flight["departure"])
    now = datetime.utcnow()
    if now < departure - timedelta(hours=2):
        phase = "pre-departure"
        eta = flight["departure"]
    elif now < departure:
        phase = "boarding"
        eta = flight["departure"]
    elif now < datetime.fromisoformat(flight["arrival"]):
        phase = "in-flight"
        eta = flight["arrival"]
    else:
        phase = "landed"
        eta = flight["arrival"]

    return {
        "flight_id": flight_id,
        "status": flight["status"],
        "phase": phase,
        "origin": flight["origin"],
        "destination": flight["destination"],
        "estimated_time": eta,
        "last_updated": now.isoformat(),
    }

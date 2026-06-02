"""Durable audit + booking storage — in-memory locally, Vercel KV (Upstash REST) in prod."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Protocol

logger = logging.getLogger("mcp-tool-guard")

AUDIT_LIST_MAX = 100
BOOKING_TTL_SECONDS = 7 * 24 * 3600


def kv_prefix() -> str:
    raw = os.environ.get("MCP_KV_PREFIX", "mcp-tool-guard:").strip()
    return raw if raw.endswith(":") else f"{raw}:"


def kv_configured() -> bool:
    return bool(
        os.environ.get("KV_REST_API_URL", "").strip()
        and os.environ.get("KV_REST_API_TOKEN", "").strip()
    )


def _redis_client():
    from upstash_redis import Redis

    return Redis(
        url=os.environ["KV_REST_API_URL"].strip(),
        token=os.environ["KV_REST_API_TOKEN"].strip(),
    )


class AuditStore(Protocol):
    def append(self, entry: dict[str, Any]) -> None: ...

    def recent(self, limit: int = AUDIT_LIST_MAX, session_id: str | None = None) -> list[dict[str, Any]]: ...


class BookingStore(Protocol):
    def get(self, booking_id: str) -> dict[str, Any] | None: ...

    def set(self, booking_id: str, booking: dict[str, Any]) -> None: ...


class MemoryAuditStore:
    def __init__(self) -> None:
        self._recent: list[dict[str, Any]] = []
        self._by_session: dict[str, list[dict[str, Any]]] = {}

    def append(self, entry: dict[str, Any]) -> None:
        self._recent.append(entry)
        if len(self._recent) > AUDIT_LIST_MAX:
            self._recent = self._recent[-AUDIT_LIST_MAX:]
        session_id = entry.get("session_id")
        if session_id:
            bucket = self._by_session.setdefault(str(session_id), [])
            bucket.append(entry)
            if len(bucket) > AUDIT_LIST_MAX:
                self._by_session[str(session_id)] = bucket[-AUDIT_LIST_MAX:]

    def recent(self, limit: int = AUDIT_LIST_MAX, session_id: str | None = None) -> list[dict[str, Any]]:
        if session_id:
            entries = self._by_session.get(session_id, [])
        else:
            entries = self._recent
        return entries[-limit:]


class MemoryBookingStore:
    def __init__(self) -> None:
        self._bookings: dict[str, dict[str, Any]] = {}

    def get(self, booking_id: str) -> dict[str, Any] | None:
        return self._bookings.get(booking_id)

    def set(self, booking_id: str, booking: dict[str, Any]) -> None:
        self._bookings[booking_id] = booking


class RedisAuditStore:
    def __init__(self, redis: Any, prefix: str) -> None:
        self._redis = redis
        self._prefix = prefix

    def _key_recent(self) -> str:
        return f"{self._prefix}audit:recent"

    def _key_session(self, session_id: str) -> str:
        return f"{self._prefix}audit:session:{session_id}"

    def append(self, entry: dict[str, Any]) -> None:
        payload = json.dumps(entry, separators=(",", ":"))
        recent_key = self._key_recent()
        self._redis.lpush(recent_key, payload)
        self._redis.ltrim(recent_key, 0, AUDIT_LIST_MAX - 1)
        session_id = entry.get("session_id")
        if session_id:
            session_key = self._key_session(str(session_id))
            self._redis.lpush(session_key, payload)
            self._redis.ltrim(session_key, 0, AUDIT_LIST_MAX - 1)

    def recent(self, limit: int = AUDIT_LIST_MAX, session_id: str | None = None) -> list[dict[str, Any]]:
        key = self._key_session(session_id) if session_id else self._key_recent()
        raw_items = self._redis.lrange(key, 0, max(0, limit - 1)) or []
        out: list[dict[str, Any]] = []
        for item in raw_items:
            try:
                out.append(json.loads(item))
            except (TypeError, json.JSONDecodeError):
                continue
        return out


class RedisBookingStore:
    def __init__(self, redis: Any, prefix: str) -> None:
        self._redis = redis
        self._prefix = prefix

    def _key(self, booking_id: str) -> str:
        return f"{self._prefix}booking:{booking_id}"

    def get(self, booking_id: str) -> dict[str, Any] | None:
        raw = self._redis.get(self._key(booking_id))
        if not raw:
            return None
        try:
            return json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return None

    def set(self, booking_id: str, booking: dict[str, Any]) -> None:
        self._redis.set(
            self._key(booking_id),
            json.dumps(booking, separators=(",", ":")),
            ex=BOOKING_TTL_SECONDS,
        )


_audit_store: AuditStore | None = None
_booking_store: BookingStore | None = None


def get_audit_store() -> AuditStore:
    global _audit_store
    if _audit_store is None:
        if kv_configured():
            logger.info("[MCPToolGuard] Audit store: Vercel KV (prefix=%s)", kv_prefix())
            _audit_store = RedisAuditStore(_redis_client(), kv_prefix())
        else:
            _audit_store = MemoryAuditStore()
    return _audit_store


def get_booking_store() -> BookingStore:
    global _booking_store
    if _booking_store is None:
        if kv_configured():
            logger.info("[MCPToolGuard] Booking store: Vercel KV (prefix=%s)", kv_prefix())
            _booking_store = RedisBookingStore(_redis_client(), kv_prefix())
        else:
            _booking_store = MemoryBookingStore()
    return _booking_store

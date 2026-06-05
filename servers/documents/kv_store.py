"""Audit storage for documents MCP — in-memory locally, optional Vercel KV in prod."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Protocol

logger = logging.getLogger("mcp-tool-guard")

AUDIT_LIST_MAX = 100


def kv_prefix() -> str:
    raw = os.environ.get("MCP_KV_PREFIX", "mcp-tool-guard:").strip()
    return raw if raw.endswith(":") else f"{raw}:"


def kv_configured() -> bool:
    return bool(
        os.environ.get("KV_REST_API_URL", "").strip()
        and os.environ.get("KV_REST_API_TOKEN", "").strip()
    )


class AuditStore(Protocol):
    def append(self, entry: dict[str, Any]) -> None: ...

    def recent(self, limit: int = AUDIT_LIST_MAX, session_id: str | None = None) -> list[dict[str, Any]]: ...


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


class KvAuditStore:
    def __init__(self) -> None:
        from upstash_redis import Redis

        self._redis = Redis(
            url=os.environ["KV_REST_API_URL"].strip(),
            token=os.environ["KV_REST_API_TOKEN"].strip(),
        )
        self._list_key = f"{kv_prefix()}documents:audit"

    def append(self, entry: dict[str, Any]) -> None:
        self._redis.lpush(self._list_key, json.dumps(entry))
        self._redis.ltrim(self._list_key, 0, AUDIT_LIST_MAX - 1)
        session_id = entry.get("session_id")
        if session_id:
            key = f"{kv_prefix()}documents:audit:session:{session_id}"
            self._redis.lpush(key, json.dumps(entry))
            self._redis.ltrim(key, 0, AUDIT_LIST_MAX - 1)

    def recent(self, limit: int = AUDIT_LIST_MAX, session_id: str | None = None) -> list[dict[str, Any]]:
        if session_id:
            key = f"{kv_prefix()}documents:audit:session:{session_id}"
            raw = self._redis.lrange(key, 0, limit - 1)
        else:
            raw = self._redis.lrange(self._list_key, 0, limit - 1)
        out: list[dict[str, Any]] = []
        for item in reversed(raw or []):
            try:
                out.append(json.loads(item))
            except json.JSONDecodeError:
                logger.warning("Skipping corrupt audit row")
        return out


_audit_store: AuditStore | None = None


def get_audit_store() -> AuditStore:
    global _audit_store
    if _audit_store is None:
        if kv_configured():
            _audit_store = KvAuditStore()
            logger.info("[MCPToolGuard] Documents audit: Vercel KV")
        else:
            _audit_store = MemoryAuditStore()
    return _audit_store

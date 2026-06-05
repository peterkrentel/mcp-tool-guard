"""In-memory mock internal documents for MCPToolGuard demos."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone

_SEED: dict[str, dict] = {
    "DOC-07": {
        "id": "DOC-07",
        "title": "On-call runbook",
        "tags": ["ops", "runbook"],
        "status": "published",
        "body": "Page the on-call lead. Check #incidents. Roll back via deploy pipeline v2.",
    },
    "DOC-42": {
        "id": "DOC-42",
        "title": "Refund policy",
        "tags": ["policy", "finance"],
        "status": "published",
        "body": "Refunds within 24h of booking. Admin approval required after check-in.",
    },
    "DOC-15": {
        "id": "DOC-15",
        "title": "MCP tool guard overview",
        "tags": ["security", "mcp"],
        "status": "published",
        "body": "Enforce JWT scopes on tools/call. Server audit is authoritative.",
    },
    "DOC-99": {
        "id": "DOC-99",
        "title": "Draft: Q3 roadmap",
        "tags": ["draft"],
        "status": "draft",
        "body": "Guard proxy, multi-server UI, observability export.",
    },
}

_documents: dict[str, dict] = deepcopy(_SEED)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_documents() -> list[dict]:
    return [
        {
            "id": d["id"],
            "title": d["title"],
            "tags": d.get("tags", []),
            "status": d.get("status", "published"),
        }
        for d in _documents.values()
    ]


def get_document(doc_id: str) -> dict | None:
    doc = _documents.get(doc_id.upper())
    return deepcopy(doc) if doc else None


def search_documents(query: str) -> list[dict]:
    q = query.lower().strip()
    if not q:
        return list_documents()
    hits = []
    for doc in _documents.values():
        hay = f"{doc['title']} {doc.get('body', '')} {' '.join(doc.get('tags', []))}".lower()
        if q in hay:
            hits.append(
                {
                    "id": doc["id"],
                    "title": doc["title"],
                    "tags": doc.get("tags", []),
                    "status": doc.get("status", "published"),
                }
            )
    return hits


def publish_document(
    title: str,
    body: str,
    doc_id: str | None = None,
    tags: list[str] | None = None,
) -> dict:
    if doc_id:
        existing = _documents.get(doc_id.upper())
        if not existing:
            raise ValueError(f"Document {doc_id} not found")
        existing["title"] = title
        existing["body"] = body
        if tags is not None:
            existing["tags"] = tags
        existing["status"] = "published"
        existing["updated_at"] = _now()
        return deepcopy(existing)

    new_id = _next_doc_id()
    doc = {
        "id": new_id,
        "title": title,
        "body": body,
        "tags": tags or [],
        "status": "published",
        "created_at": _now(),
    }
    _documents[new_id] = doc
    return deepcopy(doc)


def archive_document(doc_id: str) -> dict:
    doc = _documents.get(doc_id.upper())
    if not doc:
        raise ValueError(f"Document {doc_id} not found")
    archived = deepcopy(doc)
    del _documents[doc_id.upper()]
    archived["status"] = "archived"
    archived["archived_at"] = _now()
    return archived


def _next_doc_id() -> str:
    nums = [int(k.split("-")[1]) for k in _documents if k.startswith("DOC-")]
    n = max(nums, default=0) + 1
    return f"DOC-{n:02d}"

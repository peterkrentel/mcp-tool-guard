"""Documents MCP server — mock internal KB for MCPToolGuard multi-server demos."""

from __future__ import annotations

import json
import os
from typing import Any

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from guard import DocumentsToolGuard
from guard_middleware import JwtToolGuardMiddleware
from kv_store import kv_configured
from mock_data import (
    archive_document,
    get_document,
    list_documents,
    publish_document,
    search_documents,
)

_guard: DocumentsToolGuard | None = None


def get_guard() -> DocumentsToolGuard:
    global _guard
    if _guard is None:
        _guard = DocumentsToolGuard.load()
    return _guard


mcp = FastMCP(
    "Documents MCP",
    instructions=(
        "Mock internal knowledge base for MCPToolGuard demos. "
        "List, read, publish, and archive policy docs and runbooks."
    ),
)


def _json(data: Any) -> str:
    return json.dumps(data, indent=2)


@mcp.tool()
def list_documents_tool() -> str:
    """List all internal documents (id, title, tags, status)."""
    docs = list_documents()
    return _json({"count": len(docs), "documents": docs})


@mcp.tool()
def get_document_tool(doc_id: str) -> str:
    """Get full document body by id (e.g. DOC-42)."""
    doc = get_document(doc_id)
    if not doc:
        return _json({"error": f"Document {doc_id} not found"})
    return _json(doc)


@mcp.tool()
def search_documents_tool(query: str) -> str:
    """Search documents by keyword in title, body, or tags."""
    results = search_documents(query)
    return _json({"count": len(results), "documents": results})


@mcp.tool()
def publish_document_tool(
    title: str,
    body: str,
    doc_id: str | None = None,
    tags: list[str] | None = None,
) -> str:
    """Publish a new document or update an existing one by doc_id."""
    try:
        doc = publish_document(title=title, body=body, doc_id=doc_id, tags=tags)
        return _json({"success": True, "document": doc})
    except ValueError as exc:
        return _json({"success": False, "error": str(exc)})


@mcp.tool()
def archive_document_tool(doc_id: str) -> str:
    """Archive (delete) a document. Requires docs:delete scope."""
    try:
        doc = archive_document(doc_id)
        return _json({"success": True, "document": doc})
    except ValueError as exc:
        return _json({"success": False, "error": str(exc)})


@mcp.custom_route("/health", methods=["GET"])
async def health_check(_request: Request) -> JSONResponse:
    guard = get_guard()
    body: dict[str, Any] = {
        "status": "healthy",
        "service": "documents-mcp",
        "guard_enabled": guard.enabled,
        "jwt_trust_enabled": guard.jwt_trust.enabled,
        "kv_enabled": kv_configured(),
    }
    if not guard.enabled:
        body["warning"] = (
            "MCP_GUARD_ENABLED=false — JWT enforcement disabled; not safe for production"
        )
    return JSONResponse(body)


@mcp.custom_route("/audit", methods=["GET"])
async def audit_log(request: Request) -> JSONResponse:
    guard = get_guard()
    if guard.enabled:
        bearer = DocumentsToolGuard.extract_bearer(request.headers.get("authorization"))
        validation = guard.validate_token(bearer)
        if not validation.ok:
            return JSONResponse(
                {"error": validation.reason or "Unauthorized"},
                status_code=401,
            )

    session_id = request.query_params.get("session_id")
    return JSONResponse({"entries": guard.recent_audit(session_id=session_id)})


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

    uvicorn.run(create_app("/mcp"), host="0.0.0.0", port=8001)

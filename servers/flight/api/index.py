"""Vercel serverless entrypoint for the Flight MCP server."""

import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import create_app  # noqa: E402

PATH_PARAM = "__path"


class OriginalPathMiddleware:
    """vercel.json rewrites every public path to /api?__path=<original>. Restore that path
    for the app regardless of whether the runtime hands it the rewritten or original URL;
    MCP is mounted at "/" so the public /mcp maps to it, while /health and /audit keep
    their own routes."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            params = parse_qsl(scope.get("query_string", b"").decode(), keep_blank_values=True)
            original = next((v for k, v in params if k == PATH_PARAM), None)
            path = original if original is not None else scope["path"]
            if path in ("/mcp", "/api"):
                path = "/"
            scope = dict(scope)
            scope["path"] = path
            scope["raw_path"] = path.encode()
            scope["query_string"] = urlencode([(k, v) for k, v in params if k != PATH_PARAM]).encode()
        await self.app(scope, receive, send)


# Vercel routes /api to this handler; MCP is mounted at the root of the function.
app = OriginalPathMiddleware(create_app("/"))

"""Vercel serverless entrypoint for the Flight MCP server."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from path_restore import OriginalPathMiddleware  # noqa: E402
from server import create_app  # noqa: E402

# Vercel routes /api to this handler; MCP is mounted at the root of the function.
app = OriginalPathMiddleware(create_app("/"), "/", "api/index.py")

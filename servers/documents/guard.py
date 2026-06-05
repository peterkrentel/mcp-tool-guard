"""Server-side JWT scope enforcement for Flight MCP (mirrors gateway/guard.ts)."""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import jwt
import yaml
from jwt import PyJWKClient

from kv_store import get_audit_store

logger = logging.getLogger("mcp-tool-guard")

SERVER_ID = "documents"


@dataclass
class ToolConfig:
    required_scope: str
    alert: bool = False
    log_level: str = "info"


@dataclass
class GuardResult:
    allowed: bool
    required_scope: str
    reason: str | None = None
    token_scopes: list[str] = field(default_factory=list)


@dataclass
class TokenValidation:
    ok: bool
    payload: dict[str, Any] | None = None
    scopes: list[str] = field(default_factory=list)
    reason: str | None = None


@dataclass
class AuditEntry:
    timestamp: str
    decision: str
    server: str
    tool: str
    required_scope: str
    token_scopes: list[str]
    reason: str | None = None
    alert: bool = False
    duration_ms: int | None = None
    session_id: str | None = None
    trace_id: str | None = None


@dataclass
class JwtTrustConfig:
    issuer: str | None = None
    audience: str | None = None
    jwks_url: str | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.issuer and self.audience and self.jwks_url)

    @classmethod
    def from_env(cls) -> JwtTrustConfig:
        issuer = os.environ.get("MCP_JWT_ISSUER", "").strip() or None
        audience = os.environ.get("MCP_JWT_AUDIENCE", "").strip() or None
        jwks_url = os.environ.get("MCP_JWT_JWKS_URL", "").strip() or None
        if issuer and not jwks_url:
            jwks_url = issuer.rstrip("/") + "/.well-known/jwks.json"
        return cls(issuer=issuer, audience=audience, jwks_url=jwks_url)


class DocumentsToolGuard:
    def __init__(
        self,
        tools: dict[str, ToolConfig],
        public_key_pem: str,
        jwt_trust: JwtTrustConfig | None = None,
    ) -> None:
        self.tools = tools
        self.public_key_pem = public_key_pem
        self.jwt_trust = jwt_trust or JwtTrustConfig.from_env()
        self.enabled = os.environ.get("MCP_GUARD_ENABLED", "true").lower() != "false"
        self._audit_store = get_audit_store()
        self._jwks_client: PyJWKClient | None = None

        if not self.enabled:
            logger.warning(
                "[MCPToolGuard] MCP_GUARD_ENABLED=false — JWT enforcement DISABLED. "
                "tools/call and /audit are not protected. Do not use in production."
            )
        elif self.jwt_trust.enabled:
            logger.info(
                "[MCPToolGuard] Dual trust: JWKS (%s) + demo PEM",
                self.jwt_trust.jwks_url,
            )

    @classmethod
    def load(cls) -> DocumentsToolGuard:
        """Load demo embedded guard policy from guard_config.yaml (see gateway/config.yaml)."""
        config_path = Path(__file__).parent / "guard_config.yaml"
        raw = yaml.safe_load(config_path.read_text())
        tools_raw = raw.get("tools", {})
        tools = {
            name: ToolConfig(
                required_scope=cfg["required_scope"],
                alert=bool(cfg.get("alert", False)),
                log_level=str(cfg.get("log_level", "info")),
            )
            for name, cfg in tools_raw.items()
        }
        return cls(tools=tools, public_key_pem=_load_public_key_pem())

    @staticmethod
    def extract_scopes(payload: dict[str, Any]) -> list[str]:
        scopes: list[str] = []
        raw = payload.get("scope") or payload.get("scopes") or payload.get("scp")
        if raw:
            if isinstance(raw, list):
                scopes.extend(str(s) for s in raw)
            else:
                scopes.extend(s for s in str(raw).replace(",", " ").split() if s)
        perms = payload.get("permissions")
        if isinstance(perms, list):
            scopes.extend(str(p) for p in perms)
        seen: set[str] = set()
        out: list[str] = []
        for s in scopes:
            if s not in seen:
                seen.add(s)
                out.append(s)
        return out

    @staticmethod
    def has_scope(token_scopes: list[str], required: str) -> bool:
        if required in token_scopes:
            return True
        resource = required.split(":", 1)[0]
        return f"{resource}:*" in token_scopes or "*" in token_scopes

    @staticmethod
    def extract_bearer(header_value: str | None) -> str | None:
        if not header_value:
            return None
        if header_value.lower().startswith("bearer "):
            token = header_value[7:].strip()
            return token or None
        return None

    def _jwks(self) -> PyJWKClient:
        if self._jwks_client is None:
            if not self.jwt_trust.jwks_url:
                raise RuntimeError("JWKS URL not configured")
            self._jwks_client = PyJWKClient(self.jwt_trust.jwks_url)
        return self._jwks_client

    @staticmethod
    def _normalize_issuer(issuer: str) -> str:
        return issuer.rstrip("/") + "/"

    def _iss_matches(self, token_iss: str | None) -> bool:
        if not self.jwt_trust.issuer or not token_iss:
            return False
        return self._normalize_issuer(self.jwt_trust.issuer) == self._normalize_issuer(token_iss)

    def validate_token(self, bearer_token: str | None) -> TokenValidation:
        if not bearer_token:
            return TokenValidation(ok=False, reason="Missing Authorization: Bearer token")

        try:
            unverified = jwt.decode(
                bearer_token,
                options={"verify_signature": False},
                algorithms=["RS256"],
            )
            token_iss = unverified.get("iss")
            if isinstance(token_iss, str) and self.jwt_trust.enabled and self._iss_matches(token_iss):
                signing_key = self._jwks().get_signing_key_from_jwt(bearer_token)
                payload = jwt.decode(
                    bearer_token,
                    signing_key.key,
                    algorithms=["RS256"],
                    issuer=self._normalize_issuer(self.jwt_trust.issuer or ""),
                    audience=self.jwt_trust.audience,
                )
            else:
                payload = jwt.decode(
                    bearer_token,
                    self.public_key_pem,
                    algorithms=["RS256"],
                )
            scopes = self.extract_scopes(payload)
            return TokenValidation(ok=True, payload=payload, scopes=scopes)
        except jwt.PyJWTError as exc:
            return TokenValidation(ok=False, reason=f"JWT validation failed: {exc}")

    def _log(self, entry: AuditEntry, tool_cfg: ToolConfig | None) -> None:
        row = {
            "timestamp": entry.timestamp,
            "decision": entry.decision,
            "server": entry.server,
            "tool": entry.tool,
            "required_scope": entry.required_scope,
            "token_scopes": entry.token_scopes,
            "reason": entry.reason,
            "duration_ms": entry.duration_ms,
            "session_id": entry.session_id,
            "trace_id": entry.trace_id,
        }
        self._audit_store.append(row)
        if tool_cfg and tool_cfg.alert:
            logger.warning("[MCPToolGuard ALERT] %s", json.dumps(row))
        else:
            logger.info("[MCPToolGuard] %s", json.dumps(row))

    def authorize(
        self,
        tool: str,
        bearer_token: str | None,
        session_id: str | None = None,
        trace_id: str | None = None,
    ) -> GuardResult:
        start = time.perf_counter()
        tool_cfg = self.tools.get(tool)
        required = tool_cfg.required_scope if tool_cfg else "(unknown)"

        validation = self.validate_token(bearer_token)
        if not validation.ok:
            reason = validation.reason or "JWT validation failed"
            self._log(
                AuditEntry(
                    timestamp=_now(),
                    decision="deny",
                    server=SERVER_ID,
                    tool=tool,
                    required_scope=required,
                    token_scopes=[],
                    reason=reason,
                    duration_ms=_ms(start),
                    session_id=session_id,
                    trace_id=trace_id,
                ),
                tool_cfg,
            )
            return GuardResult(allowed=False, required_scope=required, reason=reason)

        scopes = validation.scopes

        if not tool_cfg:
            reason = f"Tool '{tool}' not configured for server '{SERVER_ID}'"
            self._log(
                AuditEntry(
                    timestamp=_now(),
                    decision="deny",
                    server=SERVER_ID,
                    tool=tool,
                    required_scope="(unknown)",
                    token_scopes=scopes,
                    reason=reason,
                    duration_ms=_ms(start),
                    session_id=session_id,
                    trace_id=trace_id,
                ),
                None,
            )
            return GuardResult(allowed=False, required_scope="(unknown)", reason=reason, token_scopes=scopes)

        allowed = self.has_scope(scopes, tool_cfg.required_scope)
        reason = None if allowed else f"Missing required scope '{tool_cfg.required_scope}'"
        self._log(
            AuditEntry(
                timestamp=_now(),
                decision="allow" if allowed else "deny",
                server=SERVER_ID,
                tool=tool,
                required_scope=tool_cfg.required_scope,
                token_scopes=scopes,
                reason=reason,
                alert=tool_cfg.alert,
                duration_ms=_ms(start),
                session_id=session_id,
                trace_id=trace_id,
            ),
            tool_cfg,
        )
        return GuardResult(
            allowed=allowed,
            required_scope=tool_cfg.required_scope,
            reason=reason,
            token_scopes=scopes,
        )

    def recent_audit(self, limit: int = 100, session_id: str | None = None) -> list[dict[str, Any]]:
        return self._audit_store.recent(limit=limit, session_id=session_id)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ms(start: float) -> int:
    return round((time.perf_counter() - start) * 1000)


def _load_public_key_pem() -> str:
    inline = os.environ.get("MCP_GUARD_PUBLIC_KEY_PEM")
    if inline:
        return inline.replace("\\n", "\n")

    root = Path(__file__).resolve().parent
    repo = root.parent.parent
    for candidate in (
        root / "demo-public.pem",
        repo / "ui" / "public" / "demo-public.pem",
        repo / "keys" / "demo-public.pem",
    ):
        if candidate.is_file():
            return candidate.read_text()

    raise RuntimeError(
        "No JWT public key found. Set MCP_GUARD_PUBLIC_KEY_PEM or run make keys."
    )

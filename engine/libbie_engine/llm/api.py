"""Cloud API backend -- Anthropic Messages API (plan section 7, Option B).

Better quality on the precision-critical join adjudication. We call the HTTP API
directly with httpx (BSD-3) rather than pulling the SDK, to keep the dependency
surface minimal and unambiguously permissive.

Model ids come from config (e.g. claude-haiku-4-5 for extraction, claude-opus-4-8
for adjudication, claude-sonnet-5 for synthesis).
"""

from __future__ import annotations

import json
from typing import Optional

import httpx

from .base import Role, extract_json
from ..config import ApiCfg

_ANTHROPIC_VERSION = "2023-06-01"
_TIMEOUT = httpx.Timeout(120.0, connect=10.0)


class AnthropicBackend:
    def __init__(self, cfg: ApiCfg, transport: "httpx.BaseTransport | None" = None):
        if not cfg.api_key:
            raise ValueError(
                "api backend selected but no API key found "
                "(set llm.api.api_key or $ANTHROPIC_API_KEY)"
            )
        self.cfg = cfg
        # `transport` is an injection point for tests (httpx.MockTransport); prod
        # leaves it None so httpx uses the real network transport.
        self._client = httpx.Client(
            base_url="https://api.anthropic.com",
            headers={
                "x-api-key": cfg.api_key,
                "anthropic-version": _ANTHROPIC_VERSION,
                "content-type": "application/json",
            },
            timeout=_TIMEOUT,
            transport=transport,
        )

    def _model_for(self, role: Role) -> str:
        return {
            "extract": self.cfg.extract,
            "adjudicate": self.cfg.adjudicate,
            "synthesize": self.cfg.synthesize,
        }.get(role, self.cfg.adjudicate)

    def complete(
        self,
        prompt: str,
        schema: Optional[dict] = None,
        role: Role = "adjudicate",
    ) -> dict:
        system = None
        content = prompt
        if schema is not None:
            system = (
                "You are a precise data-extraction service. Respond with ONLY a "
                "single JSON object conforming to the given schema. No prose."
            )
            content = prompt + "\n\nJSON schema:\n" + json.dumps(schema, indent=2)

        body: dict = {
            "model": self._model_for(role),
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": content}],
        }
        if system:
            body["system"] = system

        resp = self._client.post("/v1/messages", json=body)
        resp.raise_for_status()
        blocks = resp.json().get("content", [])
        text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
        if schema is None:
            return {"text": text}
        return extract_json(text)

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embeddings via an OpenAI-compatible endpoint (e.g. Voyage).

        Anthropic has no first-party embeddings API; the plan names voyage-3.
        """
        resp = httpx.post(
            self.cfg.embed_endpoint.rstrip("/") + "/embeddings",
            headers={"Authorization": f"Bearer {self.cfg.api_key}"},
            json={"model": self.cfg.embed, "input": texts},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = sorted(resp.json()["data"], key=lambda d: d["index"])
        return [d["embedding"] for d in data]

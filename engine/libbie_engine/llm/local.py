"""Self-hosted / open-weights backend (plan section 7, Option A).

Talks the OpenAI-compatible protocol that both vLLM and llama.cpp's server expose,
so a lab can run Qwen3 / Llama-3.3 (AWQ/GPTQ) behind vLLM as a persistent SLURM
job and point the engine at it -- no data leaves the cluster.
"""

from __future__ import annotations

import json
from typing import Optional

import httpx

from .base import Role, extract_json
from ..config import LocalCfg

_TIMEOUT = httpx.Timeout(120.0, connect=10.0)


class LocalBackend:
    def __init__(self, cfg: LocalCfg, transport: "httpx.BaseTransport | None" = None):
        self.cfg = cfg
        headers = {"Content-Type": "application/json"}
        if cfg.api_key:
            headers["Authorization"] = f"Bearer {cfg.api_key}"
        # `transport` is an injection point for tests (httpx.MockTransport); prod
        # leaves it None so httpx uses the real network transport.
        self._client = httpx.Client(
            base_url=cfg.endpoint.rstrip("/"), headers=headers, timeout=_TIMEOUT, transport=transport
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
        content = prompt
        if schema is not None:
            content = (
                prompt
                + "\n\nRespond with ONLY a single JSON object conforming to this schema, "
                "no prose, no code fence:\n"
                + json.dumps(schema, indent=2)
            )
        resp = self._client.post(
            "/chat/completions",
            json={
                "model": self._model_for(role),
                "messages": [{"role": "user", "content": content}],
                "temperature": 0.0,
            },
        )
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"]
        if schema is None:
            return {"text": text}
        return extract_json(text)

    def embed(self, texts: list[str]) -> list[list[float]]:
        resp = self._client.post(
            "/embeddings",
            json={"model": self.cfg.embed, "input": texts},
        )
        resp.raise_for_status()
        data = sorted(resp.json()["data"], key=lambda d: d["index"])
        return [d["embedding"] for d in data]

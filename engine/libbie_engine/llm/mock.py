"""Deterministic, offline backend.

No network, no GPU, no API key. It exists so the entire pipeline -- ingest, join,
briefing -- runs end to end in tests and in a fresh checkout, and so CI can assert
behaviour without a model server. Two design choices make it *useful*, not just a
stub:

* ``embed`` is a real hashing embedding (token-hash -> fixed-dim, tf-weighted,
  L2-normalised). Cosine similarity between two mock embeddings reflects genuine
  token overlap, so semantic-ish candidate generation is exercisable offline.
* ``complete`` with an adjudication schema honours a ``SELF_CHECK_PRIOR=<float>``
  line that the join layer embeds in the prompt (the candidate strategy's own
  confidence). That makes the mock's accept/reject decision a real function of the
  evidence strength rather than a coin flip.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Optional

from .base import Role

_EMBED_DIM = 256
_TOKEN = re.compile(r"[A-Za-z0-9_./-]+")


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text)]


class MockBackend:
    """Offline deterministic backend implementing the LLMBackend protocol."""

    def __init__(self, dim: int = _EMBED_DIM):
        self.dim = dim

    # -- completion --------------------------------------------------------- #
    def complete(
        self,
        prompt: str,
        schema: Optional[dict] = None,
        role: Role = "adjudicate",
    ) -> dict:
        if schema is None:
            return {"text": self._deterministic_text(prompt)}

        props = (schema.get("properties") or {}) if isinstance(schema, dict) else {}

        # Join-layer adjudication shape: {accept, confidence, rationale, spans}
        if "accept" in props or "confidence" in props:
            prior = self._read_prior(prompt)
            accept = prior >= 0.5
            # Nudge toward the prior but keep it clearly deterministic.
            confidence = round(min(0.99, max(0.01, prior)), 3)
            return {
                "accept": accept,
                "confidence": confidence,
                "rationale": (
                    "mock adjudication: candidate strategy prior "
                    f"{prior:.2f} {'>=' if accept else '<'} 0.50"
                ),
                "spans": [],
            }

        # Generic structured fill: satisfy required keys with typed defaults.
        return {k: self._default_for(v) for k, v in props.items()}

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(t) for t in texts]

    # -- helpers ------------------------------------------------------------ #
    def _embed_one(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for tok in _tokenize(text):
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            idx = h % self.dim
            sign = 1.0 if (h >> 8) & 1 else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        return vec

    @staticmethod
    def _read_prior(prompt: str) -> float:
        m = re.search(r"SELF_CHECK_PRIOR\s*=\s*([0-9]*\.?[0-9]+)", prompt)
        return float(m.group(1)) if m else 0.5

    @staticmethod
    def _deterministic_text(prompt: str) -> str:
        h = hashlib.sha1(prompt.encode()).hexdigest()[:8]
        return f"[mock:{h}] offline synthesis unavailable; configure an llm backend."

    @staticmethod
    def _default_for(prop: dict) -> object:
        t = (prop or {}).get("type")
        return {
            "string": "",
            "number": 0.0,
            "integer": 0,
            "boolean": False,
            "array": [],
            "object": {},
        }.get(t, None)

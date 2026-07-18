"""The single LLM interface every call site uses (plan section 7).

    class LLMBackend(Protocol):
        def complete(self, prompt, schema=None) -> dict: ...
        def embed(self, texts) -> list[list[float]]: ...

We keep the plan's signature and add an optional ``role`` so the backend can pick
the right model per task (extract / adjudicate / synthesize) without the call site
knowing which physical model answered.
"""

from __future__ import annotations

import json
import re
from typing import Optional, Protocol, runtime_checkable

Role = str  # "extract" | "adjudicate" | "synthesize"


@runtime_checkable
class LLMBackend(Protocol):
    def complete(
        self,
        prompt: str,
        schema: Optional[dict] = None,
        role: Role = "adjudicate",
    ) -> dict:
        """Return a dict. With ``schema`` the dict is the parsed structured
        object; without it, ``{"text": "..."}``."""
        ...

    def embed(self, texts: list[str]) -> list[list[float]]:
        ...


def extract_json(text: str) -> dict:
    """Best-effort JSON extraction from a model response.

    Handles bare objects, ```json fenced blocks, and leading/trailing prose.
    Raises ValueError if nothing parses (callers decide how to recover).
    """
    text = text.strip()
    # Strip a ```json ... ``` fence if present.
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Fall back to the first balanced {...} block.
    start = text.find("{")
    if start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(text[start : i + 1])
    raise ValueError(f"no JSON object found in model output: {text[:200]!r}")

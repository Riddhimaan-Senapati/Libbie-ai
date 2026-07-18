"""Backend selection. Call sites use ``build_backend(cfg)`` and never branch on
which physical backend answered."""

from __future__ import annotations

from ..config import Config, LlmCfg
from .base import LLMBackend


def build_backend(cfg: Config | LlmCfg) -> LLMBackend:
    llm = cfg.llm if isinstance(cfg, Config) else cfg
    if llm.backend == "mock":
        from .mock import MockBackend

        return MockBackend()
    if llm.backend == "local":
        from .local import LocalBackend

        return LocalBackend(llm.local)
    if llm.backend == "api":
        from .api import AnthropicBackend

        return AnthropicBackend(llm.api)
    raise ValueError(f"unknown llm backend: {llm.backend!r}")

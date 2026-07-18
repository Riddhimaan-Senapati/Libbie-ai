"""Typed configuration loaded from the plan's section-7 YAML."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Optional

import yaml
from pydantic import BaseModel, Field


class LocalCfg(BaseModel):
    endpoint: str = "http://localhost:8000/v1"
    api_key: Optional[str] = None
    extract: str = "qwen3-32b-awq"
    adjudicate: str = "llama-3.3-70b-awq"
    synthesize: str = "qwen3-32b-awq"
    embed: str = "bge-m3"


class ApiCfg(BaseModel):
    provider: str = "anthropic"
    api_key: Optional[str] = None
    extract: str = "claude-haiku-4-5"
    adjudicate: str = "claude-opus-4-8"
    synthesize: str = "claude-sonnet-5"
    embed: str = "voyage-3"
    embed_endpoint: str = "https://api.voyageai.com/v1"


class LlmCfg(BaseModel):
    backend: Literal["local", "api", "mock"] = "mock"
    local: LocalCfg = Field(default_factory=LocalCfg)
    api: ApiCfg = Field(default_factory=ApiCfg)


class JoinCfg(BaseModel):
    commit_threshold: float = 0.75
    time_locality_days: int = 14


class StoreCfg(BaseModel):
    root: str = "./libbie_store"


class Config(BaseModel):
    llm: LlmCfg = Field(default_factory=LlmCfg)
    join: JoinCfg = Field(default_factory=JoinCfg)
    store: StoreCfg = Field(default_factory=StoreCfg)

    @classmethod
    def load(cls, path: Optional[str | Path] = None) -> "Config":
        """Load config from YAML. Missing file -> all-defaults (mock backend)."""
        if path is None:
            return cls()
        p = Path(path)
        if not p.exists():
            return cls()
        data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        cfg = cls.model_validate(data)
        # Resolve API key from environment if not set in the file.
        if cfg.llm.api.api_key is None:
            cfg.llm.api.api_key = os.environ.get("ANTHROPIC_API_KEY")
        return cfg

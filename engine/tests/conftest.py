"""Shared fixtures: build the sample graph once (ingest + join, mock backend)."""

from __future__ import annotations

from pathlib import Path

import pytest

from libbie_engine.config import Config
from libbie_engine.ingest import (
    ingest_conversations,
    ingest_git,
    ingest_hpc,
    ingest_literature,
)
from libbie_engine.join import run_join
from libbie_engine.llm import build_backend
from libbie_engine.models import Graph

ENGINE = Path(__file__).resolve().parent.parent
SAMPLE = ENGINE / "sample_data"
REPO_ROOT = ENGINE.parent


@pytest.fixture(scope="session")
def sample_dir() -> Path:
    return SAMPLE


@pytest.fixture(scope="session")
def ingested() -> Graph:
    """Every artifact class ingested into a fresh graph (no join yet)."""
    g = Graph()
    for n in ingest_hpc(str(SAMPLE / "hpc")):
        g.add_node(n)
    for n in ingest_git(str(REPO_ROOT)):
        g.add_node(n)
    for n in ingest_conversations(str(SAMPLE / "conversations")):
        g.add_node(n)
    for n in ingest_literature(str(SAMPLE / "literature")):
        g.add_node(n)
    return g


@pytest.fixture(scope="session")
def built() -> Graph:
    """Fully joined graph on the offline mock backend (deterministic).

    Built independently of the ``ingested`` fixture so join mutation doesn't leak
    into pre-join assertions."""
    g = Graph()
    for n in ingest_hpc(str(SAMPLE / "hpc")):
        g.add_node(n)
    for n in ingest_git(str(REPO_ROOT)):
        g.add_node(n)
    for n in ingest_conversations(str(SAMPLE / "conversations")):
        g.add_node(n)
    for n in ingest_literature(str(SAMPLE / "literature")):
        g.add_node(n)
    cfg = Config()  # backend defaults to mock
    run_join(g, build_backend(cfg), cfg)
    return g

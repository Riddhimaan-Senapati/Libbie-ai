"""JSON-backed graph store.

Per the plan's build order the graph starts life as JSON ("no graph DB yet");
the ``Graph`` model is Postgres+pgvector-ready when scale demands it, but nothing
here needs a database to run.
"""

from __future__ import annotations

from pathlib import Path

import msgspec

from ..models import Graph


class GraphStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "graph.json"

    def load(self) -> Graph:
        if not self.path.exists():
            return Graph()
        data = msgspec.json.decode(self.path.read_bytes())
        return Graph.model_validate(data)

    def save(self, graph: Graph) -> None:
        self.path.write_text(
            graph.model_dump_json(indent=2, exclude_none=True), encoding="utf-8"
        )

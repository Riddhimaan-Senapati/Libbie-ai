"""Typed nodes, edges, and the provenance graph.

This is the shared contract for the whole engine. Every ingester emits ``Node``
subclasses; the join layer emits ``Edge`` objects with evidence spans; the
briefing layer reads the assembled ``Graph``. Node/edge shapes follow the tables
in the plan ("Node types" and "Edge types").

Design notes
------------
* Node identity is *content-addressed* and deterministic (see ``make_id``) so the
  same artifact ingested twice collapses to one node -- essential for the join
  layer, which matches across artifact classes.
* Every node carries a ``Provenance`` envelope (source, path, mtime, hash, actor)
  so any fact in the graph can be traced back to the blob it came from.
* Edges are never silently trusted: they carry ``confidence``, ``rationale`` and
  ``evidence_spans``, and a ``status`` of ``committed`` vs ``hypothesis`` -- the
  plan's rule that "wrong edges are worse than missing edges".
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from enum import Enum
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, Field, PrivateAttr


def make_id(kind: str, *parts: Any) -> str:
    """Deterministic, content-addressed node id: ``<kind>:<sha1[:12]>``.

    Two ingests of the same underlying artifact (same discriminating parts)
    produce the same id, so nodes de-duplicate on insert into the graph.
    """
    digest = hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return f"{kind}:{digest[:12]}"


# --------------------------------------------------------------------------- #
# Provenance + evidence
# --------------------------------------------------------------------------- #
class Provenance(BaseModel):
    """Where a node came from -- the 'provenance envelope' in the plan."""

    source: str  # "github" | "slurm" | "slack" | "eml" | "pdf" | ...
    path: Optional[str] = None
    mtime: Optional[datetime] = None
    hash: Optional[str] = None
    actor: Optional[str] = None


class EvidenceSpan(BaseModel):
    """A precise, citable pointer into a source artifact.

    ``locator`` is a human/source-appropriate range: ``"L10-L20"`` for code,
    ``"chars 100-260"`` for text, ``"methods 2.1"`` for a paper section,
    ``"thread T123"`` for a chat thread.
    """

    artifact: str  # node id or raw artifact path this span lives in
    locator: Optional[str] = None
    quote: Optional[str] = None


class EnvironmentStatus(str, Enum):
    """Lazarus verdict on whether a step/run can still be executed."""

    runnable = "runnable"
    degraded = "degraded"
    dead = "dead"
    unknown = "unknown"


# --------------------------------------------------------------------------- #
# Nodes
# --------------------------------------------------------------------------- #
class Node(BaseModel):
    """Base node. Concrete node kinds set the ``kind`` discriminator literal."""

    id: str
    kind: str
    provenance: Optional[Provenance] = None


class Person(Node):
    kind: Literal["person"] = "person"
    canonical_id: str
    display_name: Optional[str] = None
    aliases: list[str] = Field(default_factory=list)
    emails: list[str] = Field(default_factory=list)
    handles: list[str] = Field(default_factory=list)


class File(Node):
    kind: Literal["file"] = "file"
    path: str
    repo: Optional[str] = None
    lang: Optional[str] = None


class Commit(Node):
    kind: Literal["commit"] = "commit"
    sha: str
    repo: Optional[str] = None
    ts: Optional[datetime] = None
    author: Optional[str] = None  # email or Person.canonical_id
    message: Optional[str] = None
    touched_files: list[str] = Field(default_factory=list)


class PipelineStep(Node):
    kind: Literal["pipeline_step"] = "pipeline_step"
    name: str
    entrypoint: Optional[str] = None
    repo: Optional[str] = None
    inputs: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    environment_status: EnvironmentStatus = EnvironmentStatus.unknown
    revival_recipe_ref: Optional[str] = None


class Param(Node):
    kind: Literal["param"] = "param"
    key: str
    value: str
    type: Optional[str] = None  # "int" | "float" | "path" | "str" | "flag"
    step_ref: Optional[str] = None


class JobRun(Node):
    kind: Literal["job_run"] = "job_run"
    job_id: str
    script_hash: Optional[str] = None
    submit_ts: Optional[datetime] = None
    node: Optional[str] = None
    partition: Optional[str] = None
    params: list[str] = Field(default_factory=list)  # Param node ids
    data_version: Optional[str] = None
    output_paths: list[str] = Field(default_factory=list)
    exit_code: Optional[int] = None
    environment_status: EnvironmentStatus = EnvironmentStatus.unknown
    revival_recipe_ref: Optional[str] = None


class Message(Node):
    kind: Literal["message"] = "message"
    ts: Optional[datetime] = None
    author: Optional[str] = None
    channel: Optional[str] = None
    thread_id: Optional[str] = None
    text: str = ""


class Decision(Node):
    kind: Literal["decision"] = "decision"
    statement: str
    ts: Optional[datetime] = None
    participants: list[str] = Field(default_factory=list)
    evidence_spans: list[EvidenceSpan] = Field(default_factory=list)


class Finding(Node):
    kind: Literal["finding"] = "finding"
    statement: str
    figure_ref: Optional[str] = None


class Paper(Node):
    kind: Literal["paper"] = "paper"
    title: str
    doi: Optional[str] = None
    authors: list[str] = Field(default_factory=list)
    year: Optional[int] = None


class Claim(Node):
    kind: Literal["claim"] = "claim"
    statement: str
    section: Optional[str] = None
    figure_ref: Optional[str] = None
    paper_ref: Optional[str] = None


# Discriminated union so a Graph round-trips through JSON with correct subtypes.
AnyNode = Annotated[
    Union[
        Person,
        File,
        Commit,
        PipelineStep,
        Param,
        JobRun,
        Message,
        Decision,
        Finding,
        Paper,
        Claim,
    ],
    Field(discriminator="kind"),
]


# --------------------------------------------------------------------------- #
# Edges
# --------------------------------------------------------------------------- #
class EdgeType(str, Enum):
    """The product. Exactly the edge set from the plan's 'Edge types' block."""

    evidences = "evidences"          # Claim    -> Finding
    supported_by = "supported_by"    # Finding  -> JobRun
    produced_by = "produced_by"      # JobRun   -> PipelineStep
    ran = "ran"                      # JobRun   -> Commit
    used = "used"                    # JobRun   -> Param
    justified_by = "justified_by"    # Param    -> Decision
    sourced_from = "sourced_from"    # Decision -> Message
    authored_by = "authored_by"      # File     -> Person
    contains = "contains"            # Paper    -> Claim
    wrote = "wrote"                  # JobRun   -> output File
    appears_in = "appears_in"        # output File -> Figure/Claim
    contextualizes = "contextualizes"  # external Paper/Finding attach


class EdgeStatus(str, Enum):
    committed = "committed"      # scored above threshold; safe to cite
    hypothesis = "hypothesis"    # below threshold; surfaced as "unverified"


class Edge(BaseModel):
    """A scored, evidence-bearing relationship between two nodes."""

    id: str
    src: str  # source node id
    dst: str  # destination node id
    type: EdgeType
    confidence: float = 0.0
    rationale: str = ""
    evidence_spans: list[EvidenceSpan] = Field(default_factory=list)
    status: EdgeStatus = EdgeStatus.hypothesis
    generator: Optional[str] = None  # which candidate strategy proposed it

    @staticmethod
    def make(src: str, dst: str, type: "EdgeType", **kw: Any) -> "Edge":
        eid = make_id("edge", src, dst, type.value if isinstance(type, EdgeType) else type)
        return Edge(id=eid, src=src, dst=dst, type=type, **kw)


# --------------------------------------------------------------------------- #
# Graph
# --------------------------------------------------------------------------- #
class Graph(BaseModel):
    """The assembled provenance graph. JSON-serializable end to end."""

    nodes: dict[str, AnyNode] = Field(default_factory=dict)
    edges: list[Edge] = Field(default_factory=list)

    # (src, dst, type) -> position in ``edges``. Built lazily on the first
    # ``add_edge`` (so a graph restored via model_validate rebuilds on demand).
    # Keep ``edges`` mutations inside ``add_edge`` or the index goes stale.
    _edge_index: Optional[dict[tuple[str, str, EdgeType], int]] = PrivateAttr(default=None)

    def add_node(self, node: Node) -> str:
        """Insert (or de-duplicate) a node; returns its id."""
        if node.id not in self.nodes:
            self.nodes[node.id] = node  # type: ignore[assignment]
        return node.id

    def add_edge(self, edge: Edge) -> None:
        """Insert an edge, de-duplicating on (src, dst, type). Keeps the
        higher-confidence copy so re-running the join layer is idempotent."""
        idx = self._edge_index
        if idx is None:
            idx = {(e.src, e.dst, e.type): i for i, e in enumerate(self.edges)}
            self._edge_index = idx
        key = (edge.src, edge.dst, edge.type)
        i = idx.get(key)
        if i is not None:
            if edge.confidence >= self.edges[i].confidence:
                self.edges[i] = edge
            return
        self.edges.append(edge)
        idx[key] = len(self.edges) - 1

    def nodes_of(self, kind: str) -> list[Node]:
        return [n for n in self.nodes.values() if n.kind == kind]

    def out_edges(self, node_id: str, type: Optional[EdgeType] = None) -> list[Edge]:
        return [
            e for e in self.edges
            if e.src == node_id and (type is None or e.type == type)
        ]

    def in_edges(self, node_id: str, type: Optional[EdgeType] = None) -> list[Edge]:
        return [
            e for e in self.edges
            if e.dst == node_id and (type is None or e.type == type)
        ]

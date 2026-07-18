"""Ingest layer -- one parser per artifact class.

Each ingester reads raw artifacts of one class and returns typed ``Node`` objects
(no cross-class edges yet; that is the join layer's job). Ingesters share person
resolution via ``ingest.base`` so the same human collapses to one ``Person`` node
across git, Slack, email and papers.
"""

from .base import person_node
from .slurm import ingest_hpc
from .git_ingest import ingest_git
from .conversation import ingest_conversations
from .literature import ingest_literature

__all__ = [
    "person_node",
    "ingest_hpc",
    "ingest_git",
    "ingest_conversations",
    "ingest_literature",
]

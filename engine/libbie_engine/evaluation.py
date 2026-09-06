"""Edge-quality evaluation (plan section 2: "the only metric that matters pre-revenue").

Scores the committed graph against a hand-labelled gold set, per edge type.
Gold edges are matched to graph nodes by *descriptor* (kind + a field or a
substring), not by id, so the gold file survives re-ingestion.

* label=true  -> edge SHOULD be committed. Present&committed = TP, else FN.
* label=false -> edge should NOT be committed (plausible-but-wrong). Committed = FP,
  else TN.

Precision = TP / (TP + FP);  Recall = TP / (TP + FN).
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .models import EdgeStatus, Graph, Node

_DEFAULT_GOLD = Path(__file__).resolve().parent.parent / "sample_data" / "gold_edges.json"


def _text_of(node: Node) -> str:
    d = node.model_dump(exclude_none=True)
    parts = []
    for k, v in d.items():
        if k in ("provenance",):
            continue
        parts.append(str(v))
    return " ".join(parts)


def _matches(node: Optional[Node], desc: dict, node_texts: dict[str, str]) -> bool:
    if node is None:
        return False
    if desc.get("kind") and node.kind != desc["kind"]:
        return False
    for k, v in desc.items():
        if k == "kind":
            continue
        if k == "contains":
            if v.lower() not in node_texts[node.id].lower():
                return False
        else:
            attr = getattr(node, k, None)
            if attr is None or str(v).lower() not in str(attr).lower():
                return False
    return True


@dataclass
class TypeScore:
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0

    @property
    def precision(self) -> Optional[float]:
        return self.tp / (self.tp + self.fp) if (self.tp + self.fp) else None

    @property
    def recall(self) -> Optional[float]:
        return self.tp / (self.tp + self.fn) if (self.tp + self.fn) else None


@dataclass
class EvalReport:
    per_type: dict[str, TypeScore] = field(default_factory=lambda: defaultdict(TypeScore))
    misses: list[str] = field(default_factory=list)
    false_positives: list[str] = field(default_factory=list)

    def totals(self) -> TypeScore:
        t = TypeScore()
        for s in self.per_type.values():
            t.tp += s.tp; t.fp += s.fp; t.fn += s.fn; t.tn += s.tn
        return t

    def render(self) -> str:
        lines = ["Edge-quality eval (committed edges vs gold)\n",
                 f"{'edge type':<28}{'P':>7}{'R':>7}{'TP':>5}{'FP':>5}{'FN':>5}"]
        for et in sorted(self.per_type):
            s = self.per_type[et]
            p = f"{s.precision:.2f}" if s.precision is not None else "  - "
            r = f"{s.recall:.2f}" if s.recall is not None else "  - "
            lines.append(f"{et:<28}{p:>7}{r:>7}{s.tp:>5}{s.fp:>5}{s.fn:>5}")
        t = self.totals()
        tp = f"{t.precision:.2f}" if t.precision is not None else "  - "
        tr = f"{t.recall:.2f}" if t.recall is not None else "  - "
        lines.append(f"{'-'*52}")
        lines.append(f"{'TOTAL':<28}{tp:>7}{tr:>7}{t.tp:>5}{t.fp:>5}{t.fn:>5}")
        if self.misses:
            lines.append("\nMissed (false negatives):")
            lines += [f"  - {m}" for m in self.misses]
        if self.false_positives:
            lines.append("\nWrongly committed (false positives):")
            lines += [f"  - {m}" for m in self.false_positives]
        return "\n".join(lines)


def run_eval(graph: Graph, gold_path: Optional[str] = None) -> EvalReport:
    path = Path(gold_path) if gold_path else _DEFAULT_GOLD
    gold = json.loads(path.read_text(encoding="utf-8")).get("edges", [])
    report = EvalReport()

    # The gold scan re-checks the same nodes and edge pool per entry; index both
    # once instead of dumping node text and scanning all edges per gold edge.
    node_texts = {nid: _text_of(n) for nid, n in graph.nodes.items()}
    committed_by_type: dict[str, list] = defaultdict(list)
    for e in graph.edges:
        if e.status == EdgeStatus.committed:
            committed_by_type[e.type.value].append(e)

    for g in gold:
        etype = g["type"]
        committed = any(
            _matches(graph.nodes.get(e.src), g["src"], node_texts)
            and _matches(graph.nodes.get(e.dst), g["dst"], node_texts)
            for e in committed_by_type.get(etype, [])
        )
        score = report.per_type[etype]
        label = g.get("label", True)
        desc = f"{etype}: {g['src']} -> {g['dst']}"
        if label:
            if committed:
                score.tp += 1
            else:
                score.fn += 1
                report.misses.append(desc + (f"  [{g['note']}]" if g.get("note") else ""))
        else:
            if committed:
                score.fp += 1
                report.false_positives.append(desc + (f"  [{g['note']}]" if g.get("note") else ""))
            else:
                score.tn += 1
    return report

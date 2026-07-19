"""Model-layer (mock backend) tests."""

from __future__ import annotations

import math

from libbie_engine.llm.mock import MockBackend


def _cos(a, b):
    return sum(x * y for x, y in zip(a, b))


def test_mock_embed_is_normalized_and_similarity_reflects_overlap():
    m = MockBackend()
    v1, v2, v3 = m.embed([
        "germline variant calling GRCh37",
        "germline variant calling GRCh37 reference",
        "completely unrelated tokens xyzzy",
    ])
    assert math.isclose(_cos(v1, v1), 1.0, abs_tol=1e-6)  # normalized
    # overlapping text is more similar than disjoint text
    assert _cos(v1, v2) > _cos(v1, v3)


def test_mock_adjudication_reads_prior():
    m = MockBackend()
    schema = {"properties": {"accept": {}, "confidence": {}, "rationale": {}}}
    hi = m.complete("edge X\nSELF_CHECK_PRIOR=0.9", schema=schema, role="adjudicate")
    lo = m.complete("edge Y\nSELF_CHECK_PRIOR=0.3", schema=schema, role="adjudicate")
    assert hi["accept"] is True and hi["confidence"] >= 0.75
    assert lo["accept"] is False and lo["confidence"] < 0.5


def test_mock_completion_without_schema_returns_text():
    out = MockBackend().complete("hello", role="synthesize")
    assert "text" in out and isinstance(out["text"], str)

"""Integration tests for the REAL local (vLLM/llama.cpp) and Anthropic backends.

We can't reach a live model server or the Anthropic API from CI, so we drive the
actual backend code (request construction, headers, JSON parsing, the join
adjudication path) through an httpx.MockTransport that returns canned,
protocol-correct responses. This proves the api/local code paths work end to end;
only the physical socket is stubbed.

To measure REAL precision against a live backend, set the backend to `api` (with
$ANTHROPIC_API_KEY) or `local` (pointing at a vLLM/llama.cpp server) in
config.yaml and run `libbie join` then `libbie eval`.
"""

from __future__ import annotations

import json
import re

import httpx
import pytest

from libbie_engine.config import ApiCfg, Config, LocalCfg
from libbie_engine.llm.api import AnthropicBackend
from libbie_engine.llm.local import LocalBackend
from libbie_engine.join import run_join
from libbie_engine.models import EdgeStatus, EdgeType, Graph


def _prior_from(request: httpx.Request) -> float:
    body = json.loads(request.content.decode())
    # OpenAI shape: messages[-1].content ; Anthropic shape: messages[-1].content
    content = body["messages"][-1]["content"]
    m = re.search(r"SELF_CHECK_PRIOR=([0-9.]+)", content)
    return float(m.group(1)) if m else 0.5


# --------------------------------------------------------------------------- #
# local (OpenAI-compatible) backend
# --------------------------------------------------------------------------- #
def test_local_complete_sends_openai_shape_and_parses_json():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content.decode())
        return httpx.Response(200, json={
            "choices": [{"message": {"content": '{"accept": true, "confidence": 0.91, "rationale": "ok"}'}}]
        })

    be = LocalBackend(LocalCfg(endpoint="http://gpu-node:8000/v1", adjudicate="qwen3-32b-awq"),
                      transport=httpx.MockTransport(handler))
    out = be.complete("edge?\nSELF_CHECK_PRIOR=0.9", schema={"properties": {"accept": {}}}, role="adjudicate")

    assert out == {"accept": True, "confidence": 0.91, "rationale": "ok"}
    assert seen["url"].endswith("/chat/completions")
    assert seen["body"]["model"] == "qwen3-32b-awq"        # role -> model routing
    assert seen["body"]["temperature"] == 0.0
    assert "messages" in seen["body"]


def test_local_embed_parses_and_orders_vectors():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [
            {"index": 1, "embedding": [0.3, 0.4]},
            {"index": 0, "embedding": [0.1, 0.2]},
        ]})

    be = LocalBackend(LocalCfg(endpoint="http://gpu-node:8000/v1"),
                      transport=httpx.MockTransport(handler))
    vecs = be.embed(["a", "b"])
    assert vecs == [[0.1, 0.2], [0.3, 0.4]]  # re-sorted by index


# --------------------------------------------------------------------------- #
# Anthropic API backend
# --------------------------------------------------------------------------- #
def test_anthropic_complete_sends_correct_headers_and_body():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content.decode())
        return httpx.Response(200, json={
            "content": [{"type": "text", "text": '{"accept": false, "confidence": 0.2, "rationale": "weak"}'}]
        })

    be = AnthropicBackend(ApiCfg(api_key="sk-test", adjudicate="claude-opus-4-8"),
                          transport=httpx.MockTransport(handler))
    out = be.complete("adjudicate this\nSELF_CHECK_PRIOR=0.2",
                      schema={"properties": {"accept": {}}}, role="adjudicate")

    assert out == {"accept": False, "confidence": 0.2, "rationale": "weak"}
    assert seen["url"].endswith("/v1/messages")
    assert seen["headers"]["x-api-key"] == "sk-test"
    assert seen["headers"]["anthropic-version"] == "2023-06-01"
    assert seen["body"]["model"] == "claude-opus-4-8"
    assert seen["body"]["max_tokens"] >= 1
    assert "system" in seen["body"]  # schema path sets a JSON-only system prompt


# --------------------------------------------------------------------------- #
# The whole join layer through the REAL Anthropic code path (not MockBackend)
# --------------------------------------------------------------------------- #
def test_full_join_runs_through_real_anthropic_backend(ingested: Graph):
    """A 'fake Claude' that adjudicates from the embedded prior, exercised through
    the actual api.py request/response code — the demo chain must still commit and
    the plausible-but-wrong '30' edge must stay a hypothesis."""

    def handler(request: httpx.Request) -> httpx.Response:
        prior = _prior_from(request)
        accept = prior >= 0.5
        payload = {"accept": accept, "confidence": prior,
                   "rationale": f"adjudicated via prior {prior:.2f}", "spans": []}
        return httpx.Response(200, json={"content": [{"type": "text", "text": json.dumps(payload)}]})

    backend = AnthropicBackend(ApiCfg(api_key="sk-test"), transport=httpx.MockTransport(handler))
    g: Graph = ingested.model_copy(deep=True)  # don't mutate the shared fixture
    summary = run_join(g, backend, Config())

    assert summary["committed"] >= 1
    # demo chain commits
    assert any(e.type == EdgeType.justified_by and e.status == EdgeStatus.committed for e in g.edges)
    assert any(e.type == EdgeType.sourced_from and e.status == EdgeStatus.committed for e in g.edges)
    # the coincidental confidence-threshold=30 link stays unverified
    bad = [p for p in g.nodes_of("param") if p.key == "standard-min-confidence-threshold-for-calling"]
    assert bad
    assert not [e for e in g.out_edges(bad[0].id, EdgeType.justified_by)
                if e.status == EdgeStatus.committed]

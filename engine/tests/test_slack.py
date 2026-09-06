"""Tests for the live Slack connector.

Every HTTP call is driven through an ``httpx.MockTransport`` returning canned,
protocol-correct Slack Web API responses -- passing ``transport`` forces the
httpx path, so ``slack_sdk`` is never used and NO real network is touched.
"""

from __future__ import annotations

import httpx
import pytest

from libbie_engine import credentials as cred
from libbie_engine import slack as sl
from libbie_engine.models import Message, Person


def _route(routes):
    """Build a MockTransport that dispatches on the last path segment (method)."""

    def handler(request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        cursor = request.url.params.get("cursor")
        payload = routes[method]
        if callable(payload):
            return payload(request, cursor)
        return httpx.Response(200, json=payload)

    return httpx.MockTransport(handler)


# --------------------------------------------------------------------------- #
# auth.test
# --------------------------------------------------------------------------- #
def test_validate_token_ok():
    t = _route({"auth.test": {"ok": True, "user": "elena", "team": "Lab", "user_id": "U1"}})
    ident = sl.validate_token("xoxp-abc", transport=t)
    assert ident["user"] == "elena"
    assert ident["team"] == "Lab"


def test_validate_token_raises_on_not_ok():
    t = _route({"auth.test": {"ok": False, "error": "invalid_auth"}})
    with pytest.raises(sl.SlackError):
        sl.validate_token("bad", transport=t)


# --------------------------------------------------------------------------- #
# conversations.list -- cursor pagination
# --------------------------------------------------------------------------- #
def test_list_channels_follows_cursor_pagination():
    def conv_list(request, cursor):
        if not cursor:
            return httpx.Response(200, json={
                "ok": True,
                "channels": [{"id": "C1", "name": "genomics", "is_private": False}],
                "response_metadata": {"next_cursor": "PAGE2"},
            })
        return httpx.Response(200, json={
            "ok": True,
            "channels": [
                {"id": "G9", "name": "secret", "is_private": True},
                {"id": "D2", "is_im": True},
            ],
            "response_metadata": {"next_cursor": ""},
        })

    t = _route({"conversations.list": conv_list})
    channels = sl.list_channels("xoxp", transport=t)
    assert [c.id for c in channels] == ["C1", "G9", "D2"]
    assert channels[0].name == "genomics" and channels[0].is_private is False
    assert channels[1].is_private is True
    assert channels[2].is_im is True and channels[2].label == "D2"  # IM -> id label


# --------------------------------------------------------------------------- #
# conversations.history -> Message + Person mapping
# --------------------------------------------------------------------------- #
def test_ingest_channels_maps_messages_and_people():
    users = {
        "ok": True,
        "members": [
            {"id": "U1", "real_name": "Elena Vasquez", "name": "elena",
             "profile": {"email": "evasquez@lab.edu", "display_name": "elena"}},
            {"id": "U2", "real_name": "Sam Roy", "name": "sam",
             "profile": {"email": "sam@lab.edu", "display_name": "sam"}},
        ],
    }
    info = {"ok": True, "channel": {"id": "C1", "name": "genomics"}}

    def history(request, cursor):
        if not cursor:
            return httpx.Response(200, json={
                "ok": True,
                "messages": [
                    {"type": "message", "user": "U1", "text": "we go with GRCh37",
                     "ts": "1676280000.000200", "thread_ts": "1676280000.000200"},
                    {"type": "message", "subtype": "channel_join", "user": "U2",
                     "text": "joined", "ts": "1676280001.000000"},
                ],
                "response_metadata": {"next_cursor": "P2"},
            })
        return httpx.Response(200, json={
            "ok": True,
            "messages": [
                {"type": "message", "user": "U2", "text": "agreed",
                 "ts": "1676280100.000000", "thread_ts": "1676280000.000200"},
            ],
            "response_metadata": {"next_cursor": ""},
        })

    t = _route({
        "users.list": users,
        "conversations.info": info,
        "conversations.history": history,
    })

    nodes = sl.ingest_channels("xoxp", ["C1"], transport=t)
    messages = [n for n in nodes if isinstance(n, Message)]
    people = [n for n in nodes if isinstance(n, Person)]

    # 2 real messages (channel_join subtype skipped).
    assert len(messages) == 2
    m0 = messages[0]
    assert m0.author == "evasquez@lab.edu"          # user id resolved to email
    assert m0.channel == "genomics"                 # info resolved the name
    assert m0.thread_id == "1676280000.000200"      # thread_ts carried through
    assert m0.ts is not None and m0.ts.year == 2023 # epoch parsed to datetime
    # Both authors surface as email-keyed Person nodes.
    emails = {e for p in people for e in p.emails}
    assert emails == {"evasquez@lab.edu", "sam@lab.edu"}


def test_ingest_channels_honors_oldest_param():
    seen = {}

    def history(request, cursor):
        seen["oldest"] = request.url.params.get("oldest")
        return httpx.Response(200, json={"ok": True, "messages": [], "response_metadata": {"next_cursor": ""}})

    t = _route({
        "users.list": {"ok": True, "members": []},
        "conversations.info": {"ok": True, "channel": {"id": "C1", "name": "c"}},
        "conversations.history": history,
    })
    sl.ingest_channels("xoxp", ["C1"], oldest=1676280000.0, transport=t)
    assert seen["oldest"] == "1676280000.0"


# --------------------------------------------------------------------------- #
# 429 Retry-After handling
# --------------------------------------------------------------------------- #
def test_call_honors_retry_after_on_429():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "2"}, json={"ok": False})
        return httpx.Response(200, json={"ok": True, "user": "e"})

    slept: list[float] = []
    data = sl._call(
        "auth.test", "tok",
        transport=httpx.MockTransport(handler),
        sleep=slept.append,
    )
    assert data["ok"] is True
    assert calls["n"] == 2          # retried once after the 429
    assert slept == [2.0]           # waited the advertised Retry-After


# --------------------------------------------------------------------------- #
# OAuth v2 -- authorize url + code exchange (user token = authed_user)
# --------------------------------------------------------------------------- #
def test_build_authorize_url_has_user_scopes_and_fixed_port():
    url = sl.build_authorize_url("cid-1", "state-xyz", port=3118)
    assert url.startswith(sl._AUTHORIZE_URL)
    assert "user_scope=" in url and "channels%3Ahistory" in url
    assert "redirect_uri=http%3A%2F%2Flocalhost%3A3118%2Fcallback" in url
    assert "state=state-xyz" in url


def test_exchange_code_returns_authed_user_token():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = dict(httpx.QueryParams(request.content.decode()))
        return httpx.Response(200, json={
            "ok": True,
            "access_token": "xoxb-BOT-token",          # bot token (NOT what we want)
            "authed_user": {"id": "U1", "access_token": "xoxp-USER-token"},
        })

    token = sl.exchange_code(
        "the-code", "cid", "secret", port=3118,
        transport=httpx.MockTransport(handler),
    )
    assert token == "xoxp-USER-token"                  # user token, not the bot token
    assert seen["body"]["code"] == "the-code"
    assert seen["body"]["redirect_uri"].endswith(":3118/callback")


def test_exchange_code_raises_without_user_token():
    t = httpx.MockTransport(lambda r: httpx.Response(200, json={"ok": True, "access_token": "xoxb-x"}))
    with pytest.raises(sl.SlackError):
        sl.exchange_code("c", "cid", "sec", transport=t)


# --------------------------------------------------------------------------- #
# token storage (file fallback under the store root)
# --------------------------------------------------------------------------- #
def test_token_storage_roundtrip_file_fallback(tmp_path, monkeypatch):
    monkeypatch.setitem(__import__("sys").modules, "keyring", None)
    assert cred.load_token("slack", tmp_path) is None
    cred.save_token("slack", "xoxp-stored", tmp_path)
    assert cred.load_token("slack", tmp_path) == "xoxp-stored"
    assert (tmp_path / ".slack_token").exists()
    cred.clear_token("slack", tmp_path)
    assert cred.load_token("slack", tmp_path) is None

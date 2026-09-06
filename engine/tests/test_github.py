"""Tests for the GitHub integration (device flow, repo listing, safe clone).

Following the same pattern as ``test_backends_integration.py``, every HTTP call
is driven through an ``httpx.MockTransport`` returning canned, protocol-correct
responses -- NO real network is ever touched. The clone path is unit-tested by
asserting the argv/env we build (the token must not leak into argv or the URL)
plus the ``full_name`` validation; no live ``git clone`` runs.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from libbie_engine import credentials as cred
from libbie_engine import github as gh


# --------------------------------------------------------------------------- #
# request_device_code
# --------------------------------------------------------------------------- #
def test_request_device_code_parses_response_and_sends_json_accept():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["accept"] = request.headers.get("accept")
        seen["body"] = dict(httpx.QueryParams(request.content.decode()))
        return httpx.Response(200, json={
            "device_code": "dev-123",
            "user_code": "WXYZ-1234",
            "verification_uri": "https://github.com/login/device",
            "expires_in": 900,
            "interval": 5,
        })

    dc = gh.request_device_code("cid-abc", scope="repo",
                                transport=httpx.MockTransport(handler))

    assert dc.device_code == "dev-123"
    assert dc.user_code == "WXYZ-1234"
    assert dc.verification_uri == "https://github.com/login/device"
    assert dc.interval == 5
    assert seen["url"] == gh._DEVICE_CODE_URL
    assert seen["accept"] == "application/json"
    assert seen["body"] == {"client_id": "cid-abc", "scope": "repo"}


# --------------------------------------------------------------------------- #
# poll_for_token
# --------------------------------------------------------------------------- #
def test_poll_for_token_handles_pending_then_success():
    responses = [
        {"error": "authorization_pending"},
        {"error": "slow_down", "interval": 10},
        {"access_token": "ghu_realtoken", "token_type": "bearer", "scope": "repo"},
    ]
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        body = dict(httpx.QueryParams(request.content.decode()))
        assert body["grant_type"] == gh._GRANT_TYPE
        assert body["client_id"] == "cid-abc"
        assert body["device_code"] == "dev-123"
        payload = responses[calls["n"]]
        calls["n"] += 1
        return httpx.Response(200, json=payload)

    slept: list[float] = []
    token = gh.poll_for_token(
        "cid-abc", "dev-123", interval=5,
        transport=httpx.MockTransport(handler),
        sleep=slept.append,  # don't actually sleep
    )

    assert token == "ghu_realtoken"
    assert calls["n"] == 3               # pending, slow_down, success
    assert slept and slept[-1] >= 10     # slow_down backed off (>= interval+5)


def test_poll_for_token_raises_on_access_denied():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"error": "access_denied"})

    with pytest.raises(gh.DeviceFlowError):
        gh.poll_for_token("cid", "dev", interval=1,
                          transport=httpx.MockTransport(handler),
                          sleep=lambda _s: None)


def test_poll_for_token_raises_on_expired_token():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"error": "expired_token"})

    with pytest.raises(gh.DeviceFlowError):
        gh.poll_for_token("cid", "dev", interval=1,
                          transport=httpx.MockTransport(handler),
                          sleep=lambda _s: None)


# --------------------------------------------------------------------------- #
# list_repos (Link-header pagination)
# --------------------------------------------------------------------------- #
def test_list_repos_follows_link_pagination():
    page2 = "https://api.github.com/user/repos?page=2&per_page=100"
    seen_headers = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.update(request.headers)
        if "page=2" in str(request.url):
            return httpx.Response(200, json=[
                {"full_name": "org/private-repo", "private": True,
                 "description": "secret", "default_branch": "main",
                 "clone_url": "https://github.com/org/private-repo.git"},
            ])
        # first page: advertise a next link
        return httpx.Response(
            200,
            headers={"Link": f'<{page2}>; rel="next", <{page2}>; rel="last"'},
            json=[
                {"full_name": "me/public-repo", "private": False,
                 "description": None, "default_branch": "main",
                 "clone_url": "https://github.com/me/public-repo.git"},
            ],
        )

    repos = gh.list_repos("ghu_token", transport=httpx.MockTransport(handler))

    assert [r.full_name for r in repos] == ["me/public-repo", "org/private-repo"]
    assert repos[1].private is True
    assert repos[0].private is False
    assert seen_headers["authorization"] == "Bearer ghu_token"
    assert seen_headers["x-github-api-version"] == gh._API_VERSION


def test_next_link_parsing():
    header = ('<https://api.github.com/user/repos?page=2>; rel="next", '
              '<https://api.github.com/user/repos?page=5>; rel="last"')
    assert gh._next_link(header) == "https://api.github.com/user/repos?page=2"
    assert gh._next_link(None) is None
    assert gh._next_link('<https://x/y?page=5>; rel="last"') is None


# --------------------------------------------------------------------------- #
# clone: full_name validation + safe argv/env construction
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("bad", [
    "no-slash",
    "../etc/passwd",
    "owner/repo/extra",
    "own er/repo",
    "owner/re;po",
    "",
])
def test_clone_repo_rejects_bad_full_name(bad, tmp_path):
    with pytest.raises(ValueError):
        gh.clone_repo(bad, "tok", tmp_path / "dest")


@pytest.mark.parametrize("ok", ["owner/repo", "my-org/my.repo_1", "a/b"])
def test_full_name_regex_accepts_valid(ok):
    assert gh._FULL_NAME_RE.match(ok)


def test_build_clone_command_keeps_token_out_of_argv_and_url(tmp_path):
    askpass = tmp_path / "askpass.sh"
    cmd, env = gh._build_clone_command(
        "owner/repo", "ghu_SECRET", tmp_path / "dest", askpass,
    )

    # token must NOT appear anywhere in argv (no token-in-URL, no arg leak)
    assert not any("ghu_SECRET" in part for part in cmd)
    assert cmd[0] == "git" and "clone" in cmd
    assert cmd[cmd.index("clone") + 1 : cmd.index("clone") + 3] == ["--depth", "1"]
    # ambient credential helpers disabled so the token can't be persisted
    assert "-c" in cmd and "credential.helper=" in cmd
    assert any(p.startswith("--filter=blob:limit=") for p in cmd)
    assert "https://github.com/owner/repo.git" in cmd
    # token travels only via the environment, read by the askpass helper
    assert env[gh._ASKPASS_TOKEN_ENV] == "ghu_SECRET"
    assert env["GIT_ASKPASS"] == str(askpass)
    assert env["GIT_TERMINAL_PROMPT"] == "0"


def test_build_clone_command_rev_becomes_branch(tmp_path):
    cmd, _env = gh._build_clone_command(
        "owner/repo", "tok", tmp_path / "dest", tmp_path / "ap", rev="dev",
    )
    assert "--branch" in cmd and cmd[cmd.index("--branch") + 1] == "dev"


def test_update_repo_keeps_token_out_of_argv(tmp_path, monkeypatch):
    dest = tmp_path / "dest"
    (dest / ".git").mkdir(parents=True)
    calls: list[list[str]] = []

    class _Proc:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(cmd, capture_output, text, env):
        calls.append(list(cmd))
        return _Proc()

    monkeypatch.setattr(gh.subprocess, "run", fake_run)
    out = gh.update_repo("owner/repo", "tok", dest, rev="dev")
    assert out == dest
    assert len(calls) == 2
    for argv in calls:
        assert "tok" not in argv
    fetch = next(argv for argv in calls if "fetch" in argv)
    assert "-c" in fetch and "credential.helper=" in fetch
    assert any("reset" in argv and "FETCH_HEAD" in argv for argv in calls)


def test_update_repo_rejects_non_git_dir(tmp_path):
    with pytest.raises(gh.GitHubError):
        gh.update_repo("owner/repo", "tok", tmp_path / "notarepo")


# --------------------------------------------------------------------------- #
# token storage (file fallback under the store root)
# --------------------------------------------------------------------------- #
def test_token_storage_roundtrip_file_fallback(tmp_path, monkeypatch):
    # Force the file fallback regardless of whether `keyring` is installed.
    monkeypatch.setitem(__import__("sys").modules, "keyring", None)

    assert cred.load_token("github", tmp_path) is None
    cred.save_token("github", "ghu_stored", tmp_path)
    assert cred.load_token("github", tmp_path) == "ghu_stored"
    assert (tmp_path / ".github_token").exists()
    cred.clear_token("github", tmp_path)
    assert cred.load_token("github", tmp_path) is None

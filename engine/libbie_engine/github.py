"""GitHub integration -- OAuth device flow, repo listing, and safe cloning.

This module lets a user ingest ANY repository they can access (public, private,
or org-owned) by authenticating through GitHub's **OAuth device flow**. The flow
needs no client secret and no embedded browser: the user is shown a short code
to type into ``github.com/login/device`` on any device.

Dependency stance mirrors the rest of the engine -- PERMISSIVE ONLY. We talk to
the GitHub REST API directly with ``httpx`` (BSD-3, already a dep) and clone with
the ``git`` binary via ``subprocess``. We deliberately avoid PyGithub (LGPL)
and pygit2/libgit2 (GPL-with-linking-exception).

Security notes
--------------
* The OAuth token is NEVER written into ``.git/config``, a clone URL, argv, or a
  temp file. Cloning uses a token-less URL plus an ephemeral ``GIT_ASKPASS``
  helper; the token itself is passed only through the child ``git`` process's
  environment and the helper file is removed in a ``finally``.
* ``GIT_TERMINAL_PROMPT=0`` ensures a missing/expired token fails fast instead of
  blocking on an interactive prompt.
* ``full_name`` (``owner/repo``) is validated against a strict allow-list regex
  before it is ever interpolated into a URL, and the clone destination is
  app-controlled -- no path traversal.

Operator setup
--------------
Register a GitHub OAuth App (Settings -> Developer settings -> OAuth Apps) with
device flow enabled, and expose its client id to the engine via the
``LIBBIE_GITHUB_CLIENT_ID`` environment variable. Device flow requires no client
secret.

SSO caveat
----------
For orgs that enforce SAML SSO, a classic ``repo`` token must additionally be
authorized for that org (GitHub's "Configure SSO" on the token) or the org's
private repos will 404. This is a GitHub-side authorization step; surface it to
the user if their private org repos do not appear.
"""

from __future__ import annotations

import os
import re
import stat
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable, Optional

import httpx
from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Endpoints / constants
# --------------------------------------------------------------------------- #
_DEVICE_CODE_URL = "https://github.com/login/device/code"
_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
_API_BASE = "https://api.github.com"
_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
_API_VERSION = "2022-11-28"

_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# owner/repo -- letters, digits, dot, underscore, hyphen only (no traversal).
_FULL_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")

# Environment variable the GIT_ASKPASS helper reads the token from at clone time.
_ASKPASS_TOKEN_ENV = "LIBBIE_GH_TOKEN"


class GitHubError(Exception):
    """Any GitHub-integration failure (network, protocol, or clone)."""


class DeviceFlowError(GitHubError):
    """A terminal device-flow condition: expired code, denied, or unexpected."""


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class DeviceCode(BaseModel):
    """Response of ``POST /login/device/code``.

    ``verification_uri`` is where the user types ``user_code``; ``interval`` is
    the minimum seconds between token polls.
    """

    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: Optional[str] = None
    expires_in: int = 900
    interval: int = 5


class Repo(BaseModel):
    """A repository the token can access. Extra API fields are ignored."""

    full_name: str
    private: bool = False
    description: Optional[str] = None
    default_branch: Optional[str] = None
    clone_url: Optional[str] = None
    updated_at: Optional[str] = None


# --------------------------------------------------------------------------- #
# client id
# --------------------------------------------------------------------------- #
def get_client_id() -> Optional[str]:
    """The registered OAuth App client id from ``$LIBBIE_GITHUB_CLIENT_ID``."""
    cid = os.environ.get("LIBBIE_GITHUB_CLIENT_ID")
    return cid.strip() if cid else None


# --------------------------------------------------------------------------- #
# Device flow
# --------------------------------------------------------------------------- #
def request_device_code(
    client_id: str,
    scope: str = "repo",
    *,
    transport: "httpx.BaseTransport | None" = None,
) -> DeviceCode:
    """Step 1 -- ask GitHub for a device/user code pair.

    The classic ``repo`` scope covers public, private, and org-owned private
    repositories. ``transport`` is a test injection point (httpx.MockTransport);
    production leaves it ``None`` so httpx uses the real network.
    """
    with httpx.Client(transport=transport, timeout=_TIMEOUT) as client:
        resp = client.post(
            _DEVICE_CODE_URL,
            data={"client_id": client_id, "scope": scope},
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        return DeviceCode.model_validate(resp.json())


def poll_for_token(
    client_id: str,
    device_code: str,
    interval: int,
    *,
    transport: "httpx.BaseTransport | None" = None,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """Step 3 -- poll ``/login/oauth/access_token`` until the user authorizes.

    Honors the device-flow error protocol: keep polling on
    ``authorization_pending``; back off (+5s) on ``slow_down``; and raise
    :class:`DeviceFlowError` on ``expired_token`` / ``access_denied``. Returns the
    raw access token string on success.

    ``sleep`` is injectable so tests can drive the loop without real delays.
    """
    delay = float(max(interval, 1))
    with httpx.Client(transport=transport, timeout=_TIMEOUT) as client:
        while True:
            resp = client.post(
                _ACCESS_TOKEN_URL,
                data={
                    "client_id": client_id,
                    "device_code": device_code,
                    "grant_type": _GRANT_TYPE,
                },
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()

            token = data.get("access_token")
            if token:
                return token

            error = data.get("error")
            if error == "authorization_pending":
                sleep(delay)
                continue
            if error == "slow_down":
                # GitHub may also send a new interval; take the larger.
                delay = max(delay + 5, float(data.get("interval", 0)))
                sleep(delay)
                continue
            if error == "expired_token":
                raise DeviceFlowError(
                    "device code expired before authorization; run login again"
                )
            if error == "access_denied":
                raise DeviceFlowError("authorization was denied by the user")
            raise DeviceFlowError(
                f"unexpected device-flow response: {error or data!r}"
            )


# --------------------------------------------------------------------------- #
# Repo listing (paginated)
# --------------------------------------------------------------------------- #
def _next_link(link_header: Optional[str]) -> Optional[str]:
    """Extract the ``rel="next"`` URL from an RFC-5988 ``Link`` header, if any."""
    if not link_header:
        return None
    for part in link_header.split(","):
        m = re.search(r'<([^>]+)>\s*;\s*rel="next"', part)
        if m:
            return m.group(1)
    return None


def list_repos(
    token: str,
    *,
    transport: "httpx.BaseTransport | None" = None,
) -> list[Repo]:
    """List every repo the token can access, following ``Link`` pagination.

    Uses ``affiliation=owner,collaborator,organization_member`` so personal,
    collaborated, and org repos all appear. Keeps full_name, private,
    description, default_branch and clone_url.
    """
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": _API_VERSION,
    }
    repos: list[Repo] = []
    with httpx.Client(
        base_url=_API_BASE, headers=headers, transport=transport, timeout=_TIMEOUT
    ) as client:
        resp = client.get(
            "/user/repos",
            params={
                "per_page": 100,
                "affiliation": "owner,collaborator,organization_member",
            },
        )
        while True:
            resp.raise_for_status()
            for item in resp.json():
                repos.append(Repo.model_validate(item))
            next_url = _next_link(resp.headers.get("link"))
            if not next_url:
                break
            # ``next_url`` is absolute; httpx uses it verbatim over base_url.
            resp = client.get(next_url)
    return repos


# --------------------------------------------------------------------------- #
# Safe clone
# --------------------------------------------------------------------------- #
def _write_askpass() -> Path:
    """Write an ephemeral GIT_ASKPASS helper that echoes the token from the env.

    The helper contains NO secret -- it only reads ``$LIBBIE_GH_TOKEN`` at run
    time, so the token never lands on disk. Returns the helper's path; the caller
    must delete it in a ``finally``.
    """
    if os.name == "nt":
        fd, name = tempfile.mkstemp(suffix=".bat", prefix="libbie_askpass_")
        script = "@echo off\r\necho %{}%\r\n".format(_ASKPASS_TOKEN_ENV)
        with os.fdopen(fd, "w", encoding="ascii") as fh:
            fh.write(script)
        return Path(name)

    fd, name = tempfile.mkstemp(suffix=".sh", prefix="libbie_askpass_")
    script = '#!/bin/sh\nprintf \'%s\\n\' "${}"\n'.format("{" + _ASKPASS_TOKEN_ENV + "}")
    with os.fdopen(fd, "w", encoding="ascii") as fh:
        fh.write(script)
    os.chmod(name, stat.S_IRWXU)  # 0700 -- executable by owner only
    return Path(name)


def _build_clone_command(
    full_name: str,
    token: str,
    dest_dir: Path,
    askpass_path: Path,
    rev: Optional[str] = None,
) -> tuple[list[str], dict[str, str]]:
    """Build the ``git clone`` argv and environment for a SAFE token clone.

    The URL is token-less; the token travels only in the environment (read by the
    askpass helper). Factored out so tests can assert the argv/env without a live
    clone. ``rev`` (branch or tag) becomes a shallow ``--branch`` checkout.
    """
    url = f"https://github.com/{full_name}.git"
    # `-c credential.helper=` disables any ambient credential helper so the askpass
    # token is never persisted; `--filter=blob:limit` bounds disk use from a huge repo.
    cmd = [
        "git",
        "-c", "credential.helper=",
        "-c", "credential.useHttpPath=false",
        "clone", "--depth", "1", "--single-branch", "--filter=blob:limit=10m",
    ]
    if rev:
        cmd += ["--branch", rev]
    cmd += [url, str(dest_dir)]

    env = dict(os.environ)
    env["GIT_ASKPASS"] = str(askpass_path)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env[_ASKPASS_TOKEN_ENV] = token
    return cmd, env


def clone_repo(
    full_name: str,
    token: str,
    dest_dir: "str | Path",
    rev: Optional[str] = None,
) -> Path:
    """Shallow-clone ``owner/repo`` into ``dest_dir`` without leaking the token.

    Validates ``full_name``, writes an ephemeral GIT_ASKPASS helper, runs
    ``git clone --depth 1`` with a token-less URL, and removes the helper in a
    ``finally``. Returns the clone destination path. Raises :class:`ValueError`
    for a malformed ``full_name`` and :class:`GitHubError` on clone failure.
    """
    if not _FULL_NAME_RE.match(full_name):
        raise ValueError(
            f"invalid repository {full_name!r}; expected 'owner/repo'"
        )
    dest = Path(dest_dir)

    askpass = _write_askpass()
    try:
        cmd, env = _build_clone_command(full_name, token, dest, askpass, rev=rev)
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
        except (FileNotFoundError, OSError) as exc:
            raise GitHubError(f"could not run git: {exc}") from exc
        if proc.returncode != 0:
            # git's stderr does not contain the token (askpass hides it).
            raise GitHubError(
                f"git clone of {full_name} failed: {proc.stderr.strip()}"
            )
        return dest
    finally:
        try:
            askpass.unlink()
        except OSError:
            pass


def update_repo(
    full_name: str,
    token: str,
    dest_dir: "str | Path",
    rev: Optional[str] = None,
) -> Path:
    """Refresh an existing shallow clone in place (``fetch`` + ``reset``).

    Re-cloning on every ingest re-downloads the whole tree; fetching just the
    new tip is much cheaper for repeat ingests. Same security stance as
    :func:`clone_repo`: token-less URL, ephemeral GIT_ASKPASS helper removed in
    a ``finally``, token only ever in the child environment. Raises
    :class:`ValueError` for a malformed ``full_name`` and :class:`GitHubError`
    when ``dest_dir`` is not a git repo or a git step fails.
    """
    if not _FULL_NAME_RE.match(full_name):
        raise ValueError(
            f"invalid repository {full_name!r}; expected 'owner/repo'"
        )
    dest = Path(dest_dir)
    if not (dest / ".git").exists():
        raise GitHubError(f"cannot update {dest}: not a git repository")

    url = f"https://github.com/{full_name}.git"
    askpass = _write_askpass()
    try:
        env = dict(os.environ)
        env["GIT_ASKPASS"] = str(askpass)
        env["GIT_TERMINAL_PROMPT"] = "0"
        env[_ASKPASS_TOKEN_ENV] = token

        steps = [
            (
                "fetch",
                [
                    "git", "-c", "credential.helper=", "-c", "credential.useHttpPath=false",
                    "-C", str(dest), "fetch", "--depth", "1", "--force", url, rev or "HEAD",
                ],
            ),
            ("reset", ["git", "-C", str(dest), "reset", "--hard", "FETCH_HEAD"]),
        ]
        for label, cmd in steps:
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
            except (FileNotFoundError, OSError) as exc:
                raise GitHubError(f"could not run git: {exc}") from exc
            if proc.returncode != 0:
                # git's stderr does not contain the token (askpass hides it).
                raise GitHubError(
                    f"git {label} of {full_name} failed: {proc.stderr.strip()}"
                )
        return dest
    finally:
        try:
            askpass.unlink()
        except OSError:
            pass


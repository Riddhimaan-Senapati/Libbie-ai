"""Shared token storage for the connectors.

OS keyring when available, else a 0600 file under the store root. Tokens never
reach logs, argv, or the graph.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Optional

_KEYRING_SERVICE = "libbie"


def _token_file(connector: str, store_root: "str | Path") -> Path:
    return Path(store_root) / f".{connector}_token"


def save_token(connector: str, token: str, store_root: "str | Path") -> None:
    """Persist the token in the OS keyring if available, else a 0600 file."""
    try:
        import keyring  # optional; MIT

        keyring.set_password(_KEYRING_SERVICE, connector, token)
        return
    except Exception:
        pass  # fall through to the file store

    root = Path(store_root)
    root.mkdir(parents=True, exist_ok=True)
    path = _token_file(connector, root)
    path.write_text(token, encoding="utf-8")
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except OSError:
        pass  # best-effort on filesystems without POSIX perms (e.g. Windows)


def load_token(connector: str, store_root: "str | Path") -> Optional[str]:
    """Load a stored token (keyring first, then the file), or ``None``."""
    try:
        import keyring  # optional; MIT

        token = keyring.get_password(_KEYRING_SERVICE, connector)
        if token:
            return token
    except Exception:
        pass

    path = _token_file(connector, store_root)
    if path.exists():
        text = path.read_text(encoding="utf-8").strip()
        return text or None
    return None


def clear_token(connector: str, store_root: "str | Path") -> None:
    """Remove any stored token from both the keyring and the file store."""
    try:
        import keyring  # optional; MIT

        keyring.delete_password(_KEYRING_SERVICE, connector)
    except Exception:
        pass

    path = _token_file(connector, store_root)
    try:
        path.unlink()
    except OSError:
        pass

"""Raw artifact store: content-addressed blobs + a provenance envelope index.

The plan's first box after ingest: "raw artifact store (blobs + provenance
envelope: source, path, mtime, hash, actor)". Everything downstream can point an
``EvidenceSpan.artifact`` at a stored blob and be re-checked later.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..models import Provenance


class ArtifactStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.blobs = self.root / "raw"
        self.blobs.mkdir(parents=True, exist_ok=True)
        self.index_path = self.root / "artifacts.json"
        self._index: dict[str, dict] = {}
        if self.index_path.exists():
            self._index = json.loads(self.index_path.read_text(encoding="utf-8"))

    def put(
        self,
        data: bytes | str,
        source: str,
        path: Optional[str] = None,
        actor: Optional[str] = None,
        mtime: Optional[datetime] = None,
    ) -> str:
        """Store a blob, return its artifact id (``artifact:<sha256[:16]>``)."""
        raw = data.encode("utf-8") if isinstance(data, str) else data
        digest = hashlib.sha256(raw).hexdigest()
        aid = f"artifact:{digest[:16]}"
        blob_path = self.blobs / digest
        if not blob_path.exists():
            blob_path.write_bytes(raw)
        self._index[aid] = {
            "sha256": digest,
            "source": source,
            "path": path,
            "actor": actor,
            "mtime": (mtime or datetime.now(timezone.utc)).isoformat(),
            "size": len(raw),
        }
        self._flush()
        return aid

    def provenance(self, aid: str) -> Optional[Provenance]:
        rec = self._index.get(aid)
        if not rec:
            return None
        return Provenance(
            source=rec["source"],
            path=rec.get("path"),
            hash=rec.get("sha256"),
            actor=rec.get("actor"),
            mtime=rec.get("mtime"),
        )

    def read(self, aid: str) -> Optional[bytes]:
        rec = self._index.get(aid)
        if not rec:
            return None
        blob = self.blobs / rec["sha256"]
        return blob.read_bytes() if blob.exists() else None

    def _flush(self) -> None:
        self.index_path.write_text(
            json.dumps(self._index, indent=2, sort_keys=True), encoding="utf-8"
        )

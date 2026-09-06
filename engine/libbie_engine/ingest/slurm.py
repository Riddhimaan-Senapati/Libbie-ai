"""HPC / Slurm ingester -- the plan's build-first, highest-value parser.

An HPC run directory is a goldmine of "how was this result actually produced":
the scheduler accounting dump (``sacct``) says *which* jobs ran, on what node,
when, and with what exit status; the ``*.sbatch`` job script is the reproducible
entrypoint plus its resource envelope; and the ``slurm-<jobid>.out`` log carries
the single most valuable fact -- the *exact CLI invocation* with every flag the
scientist actually passed. This module fuses those three artifact classes into
typed nodes:

* :class:`PipelineStep`  -- one per ``*.sbatch`` script (the reproducible entrypoint).
* :class:`JobRun`        -- one per *primary* accounting row (``JobID`` without a dot).
* :class:`Param`         -- one per parsed CLI flag (from the log) and per
  ``#SBATCH`` directive (the resource envelope, attached to its step).
* :class:`File`          -- one per discovered output path (``--output``, ``wrote ...``).
* :class:`Person`        -- the run owner, resolved from the job ``WorkDir``.

No edges are emitted here -- wiring ``JobRun -> Param``, ``JobRun -> PipelineStep``
etc. is the join layer's job. We only leave *reference hints* on the nodes
(``JobRun.params``, ``Param.step_ref``, ``JobRun.script_hash``) so the join layer
has something concrete to match on.
"""

from __future__ import annotations

import hashlib
import re
import shlex
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..models import (
    EnvironmentStatus,
    File,
    JobRun,
    Node,
    Param,
    PipelineStep,
    Provenance,
    make_id,
)
from .base import person_node

# --------------------------------------------------------------------------- #
# Small parsing helpers
# --------------------------------------------------------------------------- #

# Log lines that announce an actual command invocation. We key off explicit
# markers ("Running: ...", "CMD: ...") so we don't misfire on prose lines.
# NB: the tail is a plain greedy `(.+)$` (linear) and the caller `.strip()`s it.
# Avoid the `(.+\S)\s*$` form, whose greedy-then-\s* overlap backtracks
# quadratically on long, space-heavy log lines (a ReDoS on untrusted log input).
_INVOCATION_RE = re.compile(
    r"^\s*(?:Running|Run|CMD|Command|Executing|Exec|Invoking|\$)\s*[:>]?\s*(.+)$",
    re.IGNORECASE,
)
# Defensive cap: never run the regex over an absurdly long single line.
_MAX_LOG_LINE = 20_000

# "wrote /path/to/out.vcf (...)" style success lines -> harvested as outputs.
_WROTE_RE = re.compile(r"\bwrote\s+(\S+)", re.IGNORECASE)

# Reference-genome build fingerprints. Kept deliberately small/specific.
_BUILD_RE = re.compile(r"\b(GRCh3[78]|hg1[89]|hg38|hg19|GRCm3[89]|T2T[-_]?CHM13)\b")

# "module load gatk/4.2.6.1" directives inside a job script.
_MODULE_LOAD_RE = re.compile(r"module\s+load\s+(\S+)", re.IGNORECASE)

# Entries in a "Currently Loaded Modules:" block, e.g. "1) gatk/4.2.6.1".
_LOADED_MODULE_RE = re.compile(r"\d+\)\s*(\S+)")

# A single #SBATCH directive line: "#SBATCH --mem=64G" or "#SBATCH --nodes 1".
_SBATCH_DIRECTIVE_RE = re.compile(r"^\s*#SBATCH\s+(.+?)\s*$", re.IGNORECASE)

# Numeric literals (int/float, optionally signed, optional exponent).
_NUM_RE = re.compile(r"^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$")

# Flag keys that name an output artifact.
_OUTPUT_KEYS = {"output", "o", "out", "outfile", "output-file"}

# File-ish extensions we treat as path-typed even without a leading slash.
_PATH_EXT_RE = re.compile(
    r"\.(?:vcf|bam|cram|sam|fasta|fa|fastq|fq|gz|bgz|bed|bai|tbi|csi|"
    r"txt|tsv|csv|json|yaml|yml|log|out|h5|hdf5|npz|npy|pkl|parquet)$",
    re.IGNORECASE,
)


def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    """Parse a Slurm ISO-ish timestamp; tolerate Unknown/None/empty."""
    if not value:
        return None
    text = value.strip()
    if not text or text.lower() in {"unknown", "none", "n/a", "na"}:
        return None
    # Slurm uses "2023-02-14T09:12:03"; fromisoformat handles that and offsets.
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        # Fall back to a couple of common non-ISO layouts before giving up.
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                continue
    return None


def _parse_exit_code(value: Optional[str]) -> Optional[int]:
    """Slurm ExitCode is ``<code>:<signal>``; we keep the process exit code."""
    if not value:
        return None
    head = value.strip().split(":", 1)[0]
    try:
        return int(head)
    except (ValueError, TypeError):
        return None


def _looks_like_path(value: str) -> bool:
    """Heuristic: does this token look like a filesystem path?"""
    if not value:
        return False
    # Absolute/relative/home-anchored, or a Windows drive path.
    if re.match(r"^(?:/|\./|\.\./|~|[A-Za-z]:[\\/])", value):
        return True
    # Contains a path separator and isn't a URL/option string.
    if ("/" in value or "\\" in value) and not value.startswith("-"):
        return True
    # Bare filename with a recognizable data extension.
    if _PATH_EXT_RE.search(value):
        return True
    return False


def _infer_type(value: str) -> str:
    """Infer a :class:`Param` type tag from a raw string value."""
    if _NUM_RE.match(value):
        # Distinguish int from float by presence of '.' or exponent.
        return "float" if re.search(r"[.eE]", value) else "int"
    if _looks_like_path(value):
        return "path"
    return "str"


def _is_flag(token: str) -> bool:
    """True if a token is an option flag (``-x``/``--long``) and not a number."""
    return token.startswith("-") and len(token) > 1 and not _NUM_RE.match(token)


def _sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8", errors="replace")).hexdigest()


def _read_text(path: Path) -> str:
    """Read a file as text, tolerating odd encodings (logs can be messy)."""
    return path.read_text(encoding="utf-8", errors="replace")


def _file_mtime(path: Path) -> Optional[datetime]:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    except OSError:
        return None


# --------------------------------------------------------------------------- #
# CLI flag -> Param parsing
# --------------------------------------------------------------------------- #

def _parse_cli_flags(
    command: str,
    *,
    id_scope: tuple[str, ...],
    step_ref: Optional[str],
    provenance: Provenance,
) -> tuple[list[Param], list[str]]:
    """Parse a shell command string into :class:`Param` nodes.

    Handles three flag shapes:
      * ``--key value``   (space separated)
      * ``--key=value``   (equals separated)
      * ``--flag``        (bare boolean; value="true", type="flag")

    Returns ``(params, output_paths)`` where *output_paths* are values of
    output-naming flags (``--output``/``-o``/...). Leading positional tokens
    (e.g. ``gatk HaplotypeCaller``) are ignored -- only flags become params.
    """
    try:
        tokens = shlex.split(command, posix=True)
    except ValueError:
        # Unbalanced quotes etc.: fall back to a naive whitespace split so we
        # still extract *something* rather than dropping the whole line.
        tokens = command.split()

    params: list[Param] = []
    outputs: list[str] = []
    seen_ids: set[str] = set()

    def _emit(key: str, value: str, ptype: str) -> None:
        # Deterministic, de-duplicating id scoped to the owning run/step.
        pid = make_id("param", *id_scope, key, value)
        if pid in seen_ids:
            return
        seen_ids.add(pid)
        params.append(
            Param(
                id=pid,
                key=key,
                value=value,
                type=ptype,
                step_ref=step_ref,
                provenance=provenance,
            )
        )
        if key.lower() in _OUTPUT_KEYS and value not in outputs:
            outputs.append(value)

    i = 0
    n = len(tokens)
    while i < n:
        tok = tokens[i]
        if not _is_flag(tok):
            i += 1
            continue

        # "--key=value" form.
        if "=" in tok:
            raw_key, value = tok.split("=", 1)
            key = raw_key.lstrip("-")
            if key:
                _emit(key, value, _infer_type(value))
            i += 1
            continue

        key = tok.lstrip("-")
        # "--key value": consume the next token as the value only if it is not
        # itself a flag (a negative number IS accepted as a value).
        if i + 1 < n and not _is_flag(tokens[i + 1]):
            value = tokens[i + 1]
            _emit(key, value, _infer_type(value))
            i += 2
        else:
            # Bare boolean flag.
            _emit(key, "true", "flag")
            i += 1

    return params, outputs


# --------------------------------------------------------------------------- #
# Job script (*.sbatch) parsing
# --------------------------------------------------------------------------- #

class _ScriptInfo:
    """Parsed facts about one job script, used to enrich matching JobRuns."""

    __slots__ = ("step", "script_hash", "job_name", "modules", "build", "params")

    def __init__(
        self,
        step: PipelineStep,
        script_hash: str,
        job_name: str,
        modules: list[str],
        build: Optional[str],
        params: list[Param],
    ) -> None:
        self.step = step
        self.script_hash = script_hash
        self.job_name = job_name
        self.modules = modules
        self.build = build
        self.params = params  # #SBATCH resource-envelope params


def _parse_sbatch(path: Path, store=None) -> _ScriptInfo:
    """Parse a ``*.sbatch`` script into a :class:`PipelineStep` (+ envelope params)."""
    text = _read_text(path)
    script_hash = _sha1(text)

    # Persist the raw blob if a store was provided; use its id as prov hash.
    prov_hash: Optional[str] = script_hash
    if store is not None:
        try:
            prov_hash = store.put(text, source="slurm", path=str(path))
        except Exception:  # never let persistence break ingestion
            prov_hash = script_hash

    provenance = Provenance(
        source="slurm",
        path=str(path),
        mtime=_file_mtime(path),
        hash=prov_hash,
    )

    # Collect #SBATCH directives (the resource envelope) and the job name.
    job_name: Optional[str] = None
    directives: list[tuple[str, str, str]] = []  # (key, value, type)
    modules: list[str] = []

    for line in text.splitlines():
        m = _SBATCH_DIRECTIVE_RE.match(line)
        if m:
            directive = m.group(1).strip()
            # Directives look like "--mem=64G" or "--nodes 1".
            body = directive.lstrip("-")
            if "=" in body:
                key, value = body.split("=", 1)
            else:
                parts = body.split(None, 1)
                key = parts[0]
                value = parts[1] if len(parts) > 1 else "true"
            key = key.strip()
            value = value.strip()
            if key.lower() in {"job-name", "job_name", "j"}:
                job_name = value
            ptype = "flag" if value == "true" else _infer_type(value)
            directives.append((key, value, ptype))
            continue
        mod = _MODULE_LOAD_RE.search(line)
        if mod:
            modules.append(mod.group(1))

    # Name the step from the job-name directive, else the script filename stem.
    name = job_name or path.stem
    step_id = make_id("pipeline_step", name, str(path))

    # Reference-genome build mentioned anywhere in the script.
    build_match = _BUILD_RE.search(text)
    build = build_match.group(1) if build_match else None

    step = PipelineStep(
        id=step_id,
        name=name,
        entrypoint=str(path),
        environment_status=EnvironmentStatus.unknown,
        provenance=provenance,
    )

    # Emit each #SBATCH directive as a Param anchored to the step (resource
    # envelope). These are standalone reference nodes -- not folded into any
    # JobRun.params (those hold the *invocation* flags from the run's log).
    env_params: list[Param] = []
    for key, value, ptype in directives:
        pid = make_id("param", step_id, "sbatch", key, value)
        env_params.append(
            Param(
                id=pid,
                key=key,
                value=value,
                type=ptype,
                step_ref=step_id,
                provenance=provenance,
            )
        )

    return _ScriptInfo(
        step=step,
        script_hash=script_hash,
        job_name=name,
        modules=modules,
        build=build,
        params=env_params,
    )


# --------------------------------------------------------------------------- #
# Accounting (sacct) parsing
# --------------------------------------------------------------------------- #

def _is_sacct_file(path: Path) -> bool:
    """Detect a pipe-delimited sacct dump by sniffing its header row."""
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if not line.strip():
                    continue
                first = line.strip()
                return "|" in first and re.search(r"\bJobID\b", first, re.IGNORECASE) is not None
    except OSError:
        return False
    return False


@dataclass
class _SacctMeta:
    """Sacct columns that guide assembly but don't belong on the JobRun model."""

    job_name: Optional[str]
    owner: Optional[str]
    work_dir: Optional[str]


def _parse_sacct(path: Path, store=None) -> list[tuple[JobRun, _SacctMeta]]:
    """Parse a pipe-delimited sacct dump into one primary-row :class:`JobRun`
    plus its source metadata, per row."""
    text = _read_text(path)

    prov_hash: Optional[str] = _sha1(text)
    if store is not None:
        try:
            prov_hash = store.put(text, source="slurm", path=str(path))
        except Exception:
            prov_hash = _sha1(text)

    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []

    header = [h.strip() for h in lines[0].split("|")]
    # Case-insensitive column lookup so header casing doesn't matter.
    col = {h.lower(): idx for idx, h in enumerate(header)}

    def _cell(fields: list[str], name: str) -> Optional[str]:
        idx = col.get(name.lower())
        if idx is None or idx >= len(fields):
            return None
        val = fields[idx].strip()
        return val or None

    runs: list[tuple[JobRun, _SacctMeta]] = []
    for line in lines[1:]:
        fields = [c.strip() for c in line.split("|")]
        job_id = _cell(fields, "JobID")
        if not job_id:
            continue
        # PRIMARY rows only: "48219" yes; "48219.batch"/"48219.0" no.
        if "." in job_id:
            continue

        work_dir = _cell(fields, "WorkDir")
        # Resolve the run owner from the WorkDir (e.g. /home/evasquez/...).
        owner: Optional[str] = None
        if work_dir:
            m = re.search(r"/(?:home|users)/([^/]+)", work_dir)
            if m:
                owner = m.group(1)

        provenance = Provenance(
            source="slurm",
            path=str(path),
            mtime=_file_mtime(path),
            hash=prov_hash,
            actor=owner,
        )

        run = JobRun(
            id=make_id("job_run", job_id),
            job_id=job_id,
            submit_ts=_parse_ts(_cell(fields, "Submit")),
            node=_cell(fields, "NodeList"),
            partition=_cell(fields, "Partition"),
            exit_code=_parse_exit_code(_cell(fields, "ExitCode")),
            environment_status=EnvironmentStatus.unknown,
            provenance=provenance,
        )
        runs.append((run, _SacctMeta(job_name=_cell(fields, "JobName"), owner=owner, work_dir=work_dir)))

    return runs


# --------------------------------------------------------------------------- #
# Log (slurm-<jobid>.out) parsing
# --------------------------------------------------------------------------- #

class _LogInfo:
    """Everything harvested from one job log, keyed later by job id.

    The raw log text is deliberately not kept here: it is persisted to the
    artifact store inside ``_parse_log`` and only the extracted fields are read
    by the assembler."""

    __slots__ = ("job_id", "params", "output_paths", "build", "modules", "path")

    def __init__(
        self,
        job_id: str,
        params: list[Param],
        output_paths: list[str],
        build: Optional[str],
        modules: list[str],
        path: Path,
    ) -> None:
        self.job_id = job_id
        self.params = params
        self.output_paths = output_paths
        self.build = build
        self.modules = modules
        self.path = path


_LOG_NAME_RE = re.compile(r"slurm-(\d+)", re.IGNORECASE)


def _parse_log(
    path: Path,
    *,
    step_ref: Optional[str],
    store=None,
) -> Optional[_LogInfo]:
    """Parse a ``slurm-<jobid>.out`` log; extract CLI params + outputs + env."""
    m = _LOG_NAME_RE.search(path.name)
    if not m:
        return None  # can't associate a log to a job without an id in the name
    job_id = m.group(1)

    text = _read_text(path)

    prov_hash: Optional[str] = _sha1(text)
    if store is not None:
        try:
            prov_hash = store.put(text, source="slurm", path=str(path))
        except Exception:
            prov_hash = _sha1(text)

    provenance = Provenance(
        source="slurm",
        path=str(path),
        mtime=_file_mtime(path),
        hash=prov_hash,
    )

    params: list[Param] = []
    output_paths: list[str] = []
    modules: list[str] = []

    lines = text.splitlines()
    in_loaded_block = False
    for line in lines:
        stripped = line.strip()

        # Track the "Currently Loaded Modules:" section for the env fingerprint.
        if re.match(r"currently loaded modules", stripped, re.IGNORECASE):
            in_loaded_block = True
            continue
        if in_loaded_block:
            if not stripped:
                in_loaded_block = False
            else:
                for mod in _LOADED_MODULE_RE.findall(stripped):
                    modules.append(mod)
                # A blank line ends the block; handled above.
                continue

        # High-value: an explicit command invocation line.
        inv = _INVOCATION_RE.match(line[:_MAX_LOG_LINE])
        if inv:
            cmd = inv.group(1).strip()
            new_params, new_outputs = _parse_cli_flags(
                cmd,
                id_scope=(job_id,),
                step_ref=step_ref,
                provenance=provenance,
            )
            params.extend(new_params)
            for o in new_outputs:
                if o not in output_paths:
                    output_paths.append(o)

        # "wrote <path>" success lines contribute outputs too.
        for wm in _WROTE_RE.findall(line):
            if wm not in output_paths:
                output_paths.append(wm)

    # De-duplicate params by id (an output flag can appear more than once).
    unique: dict[str, Param] = {}
    for p in params:
        unique.setdefault(p.id, p)
    params = list(unique.values())

    build_match = _BUILD_RE.search(text)
    build = build_match.group(1) if build_match else None

    return _LogInfo(
        job_id=job_id,
        params=params,
        output_paths=output_paths,
        build=build,
        modules=modules,
        path=path,
    )


# --------------------------------------------------------------------------- #
# Public entrypoint
# --------------------------------------------------------------------------- #

def _compose_data_version(build: Optional[str], modules: list[str]) -> Optional[str]:
    """Fold the genome build and module fingerprint into ``data_version``.

    The build stays first and cleanly parseable; the environment fingerprint is
    appended after a ``|`` separator so downstream code can split on it. We reuse
    the existing ``data_version`` field rather than inventing a new one.
    """
    parts: list[str] = []
    if build:
        parts.append(build)
    if modules:
        # Stable, de-duplicated module list.
        seen: list[str] = []
        for mod in modules:
            if mod not in seen:
                seen.append(mod)
        parts.append("env=" + ",".join(seen))
    if not parts:
        return None
    return " | ".join(parts)


def ingest_hpc(hpc_dir: str | Path = None, store=None) -> list[Node]:  # type: ignore[assignment]
    """Ingest an HPC run directory into typed provenance nodes.

    Parameters
    ----------
    hpc_dir:
        Directory holding ``sacct`` dumps, ``*.sbatch`` scripts and
        ``slurm-<jobid>.out`` logs. Defaults to the bundled sample dataset at
        ``sample_data/hpc`` relative to the package.
    store:
        Optional :class:`~libbie_engine.store.ArtifactStore`. When provided, raw
        blobs are persisted and the returned artifact id is used as the
        provenance hash.

    Returns
    -------
    list[Node]
        ``PipelineStep``, ``JobRun``, ``Param``, ``File`` and ``Person`` nodes.
        No edges -- the join layer wires those from the reference hints left on
        the nodes (``JobRun.params``, ``JobRun.script_hash``, ``Param.step_ref``).
    """
    # Resolve a sensible default sample directory if none was supplied.
    if hpc_dir is None:
        # libbie_engine/ingest/slurm.py -> repo root is three parents up.
        repo_root = Path(__file__).resolve().parents[2]
        hpc_dir = repo_root / "sample_data" / "hpc"
    root = Path(hpc_dir)

    nodes: list[Node] = []
    if not root.exists() or not root.is_dir():
        # Defensive: nothing to ingest -> return empty rather than raising.
        return nodes

    # -- Classify the files in the directory -------------------------------- #
    sbatch_paths: list[Path] = []
    log_paths: list[Path] = []
    sacct_paths: list[Path] = []

    for path in sorted(p for p in root.iterdir() if p.is_file()):
        name = path.name.lower()
        if name.endswith(".sbatch"):
            sbatch_paths.append(path)
        elif _LOG_NAME_RE.search(name) and (
            name.endswith(".out") or name.endswith(".log") or name.endswith(".txt")
        ):
            log_paths.append(path)
        elif _is_sacct_file(path):
            sacct_paths.append(path)

    # -- 1. Job scripts -> PipelineStep (+ #SBATCH envelope params) ---------- #
    scripts: list[_ScriptInfo] = [_parse_sbatch(p, store=store) for p in sbatch_paths]
    # Index by job name and by filename stem for later JobRun matching.
    by_name: dict[str, _ScriptInfo] = {}
    for info in scripts:
        by_name[info.job_name.lower()] = info
        by_name.setdefault(info.step.name.lower(), info)
        by_name.setdefault(Path(info.step.entrypoint or "").stem.lower(), info)
        nodes.append(info.step)
        nodes.extend(info.params)

    # -- 2. Accounting -> JobRun (primary rows only) ------------------------ #
    run_rows: list[tuple[JobRun, _SacctMeta]] = []
    for p in sacct_paths:
        run_rows.extend(_parse_sacct(p, store=store))

    # Index runs by job id so logs can attach to the right run.
    runs_by_id: dict[str, _SacctMeta] = {r.job_id: meta for r, meta in run_rows}

    # -- 3. Logs -> Params + Files, associated by job id -------------------- #
    # First pass: figure out which step each log's job belongs to (via the
    # sacct JobName), so Param.step_ref can be filled in.
    log_infos: list[_LogInfo] = []
    for p in log_paths:
        # Peek the job id to resolve the step before full parsing.
        m = _LOG_NAME_RE.search(p.name)
        step_ref: Optional[str] = None
        if m:
            meta = runs_by_id.get(m.group(1))
            if meta is not None and meta.job_name:
                info = by_name.get(str(meta.job_name).lower())
                if info is not None:
                    step_ref = info.step.id
        parsed = _parse_log(p, step_ref=step_ref, store=store)
        if parsed is not None:
            log_infos.append(parsed)

    logs_by_id: dict[str, _LogInfo] = {li.job_id: li for li in log_infos}

    # -- 4. Assemble: enrich each JobRun and emit its Params/Files ---------- #
    emitted_files: set[str] = set()

    for run, meta in run_rows:
        # Match this run to its job script (script_hash + build + modules).
        script_info: Optional[_ScriptInfo] = None
        if meta.job_name:
            script_info = by_name.get(str(meta.job_name).lower())
        if script_info is not None:
            run.script_hash = script_info.script_hash

        # Merge log-derived facts.
        log_info = logs_by_id.get(run.job_id)

        # Collect CLI params from the log and reference them on the run.
        if log_info is not None:
            for p in log_info.params:
                nodes.append(p)
            run.params = [p.id for p in log_info.params]

            # Output paths -> File nodes.
            for out_path in log_info.output_paths:
                if out_path not in run.output_paths:
                    run.output_paths.append(out_path)

        # data_version: prefer the build seen in the log, fall back to script.
        build = None
        if log_info is not None and log_info.build:
            build = log_info.build
        elif script_info is not None and script_info.build:
            build = script_info.build

        # Environment fingerprint: modules from both the log and the script.
        modules: list[str] = []
        if log_info is not None:
            modules.extend(log_info.modules)
        if script_info is not None:
            modules.extend(script_info.modules)

        run.data_version = _compose_data_version(build, modules)

        # Emit File nodes for every output path (de-duplicated across runs).
        for out_path in run.output_paths:
            fid = make_id("file", out_path)
            if fid in emitted_files:
                continue
            emitted_files.add(fid)
            nodes.append(
                File(
                    id=fid,
                    path=out_path,
                    provenance=Provenance(
                        source="slurm",
                        path=(log_info.path.as_posix() if log_info is not None else None),
                        actor=meta.owner,
                    ),
                )
            )

        # Emit a Person node for the run owner (de-dup handled by person_node id).
        if meta.owner:
            nodes.append(
                person_node(
                    source="slurm",
                    handle=meta.owner,
                    path=meta.work_dir,
                )
            )

        nodes.append(run)

    # De-duplicate nodes by id (Person/File/Param can recur across runs).
    deduped: dict[str, Node] = {}
    for node in nodes:
        deduped.setdefault(node.id, node)
    return list(deduped.values())

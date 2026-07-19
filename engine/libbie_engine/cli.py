"""``libbie`` command line: ingest -> join -> brief -> eval.

Built with Typer (MIT) -- type-hint driven, on top of click -- to match the rest
of the codebase's typed style.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer

from .config import Config
from .llm import build_backend
from .store import ArtifactStore, GraphStore

_PKG = Path(__file__).resolve().parent
_ENGINE = _PKG.parent
_REPO_ROOT = _ENGINE.parent
_SAMPLE = _ENGINE / "sample_data"

app = typer.Typer(
    help="Libbie provenance-graph engine.",
    no_args_is_help=True,
    add_completion=False,
)


def _cfg(config: Optional[Path]) -> Config:
    return Config.load(config or (_ENGINE / "config.yaml"))


def _store_root(cfg: Config) -> Path:
    root = Path(cfg.store.root)
    if not root.is_absolute():
        root = _ENGINE / root
    return root


def _stores(cfg: Config) -> tuple[ArtifactStore, GraphStore]:
    root = _store_root(cfg)
    return ArtifactStore(root), GraphStore(root)


ConfigOpt = typer.Option(None, "--config", help="Path to config.yaml (default: engine/config.yaml).")


@app.command()
def ingest(
    all_: bool = typer.Option(False, "--all", help="Ingest every artifact class."),
    sample: bool = typer.Option(False, "--sample", help="Use the bundled hero-scenario sample data."),
    hpc: Optional[Path] = typer.Option(None, "--hpc", help="HPC/SLURM directory."),
    repo: Optional[Path] = typer.Option(None, "--repo", help="Git repository path."),
    conv: Optional[Path] = typer.Option(None, "--conv", help="Conversation export directory."),
    lit: Optional[Path] = typer.Option(None, "--lit", help="Literature directory."),
    config: Optional[Path] = ConfigOpt,
) -> None:
    """Parse artifacts into typed nodes and persist the graph."""
    from .ingest import ingest_conversations, ingest_git, ingest_hpc, ingest_literature
    from .lazarus import annotate_environment

    cfg = _cfg(config)
    store, gstore = _stores(cfg)
    graph = gstore.load()

    if sample:
        hpc = hpc or (_SAMPLE / "hpc")
        conv = conv or (_SAMPLE / "conversations")
        lit = lit or (_SAMPLE / "literature")
        repo = repo or _REPO_ROOT

    steps: list[tuple[str, object, Path]] = []
    if all_ or hpc:
        steps.append(("HPC", ingest_hpc, hpc or (_SAMPLE / "hpc")))
    if all_ or repo:
        steps.append(("git", ingest_git, repo or _REPO_ROOT))
    if all_ or conv:
        steps.append(("conversation", ingest_conversations, conv or (_SAMPLE / "conversations")))
    if all_ or lit:
        steps.append(("literature", ingest_literature, lit or (_SAMPLE / "literature")))

    added = 0
    for label, fn, path in steps:
        try:
            nodes = fn(str(path), store=store)  # type: ignore[operator]
            for n in nodes:
                graph.add_node(n)
            added += len(nodes)
            typer.echo(f"  {label:<13} {len(nodes):>4} nodes  <- {path}")
        except Exception as exc:  # keep other ingesters running
            typer.echo(f"  {label:<13} FAILED: {exc}", err=True)

    annotate_environment(graph)
    gstore.save(graph)
    typer.echo(f"Ingested {added} nodes. Graph now has {len(graph.nodes)} nodes.")


@app.command()
def join(config: Optional[Path] = ConfigOpt) -> None:
    """Run candidate generation -> LLM adjudication -> commit."""
    from .join import run_join

    cfg = _cfg(config)
    _, gstore = _stores(cfg)
    graph = gstore.load()
    backend = build_backend(cfg)
    summary = run_join(graph, backend, cfg)
    gstore.save(graph)
    typer.echo(f"Join complete (backend={cfg.llm.backend}):")
    for k, v in summary.items():
        typer.echo(f"  {k}: {v}")


@app.command()
def brief(
    pipeline: Optional[str] = typer.Option(None, "--pipeline", help="Restrict to one pipeline by name substring."),
    config: Optional[Path] = ConfigOpt,
) -> None:
    """Generate the Inheritance Briefing markdown to stdout."""
    from .briefing import generate_briefing

    cfg = _cfg(config)
    _, gstore = _stores(cfg)
    graph = gstore.load()
    backend = build_backend(cfg)
    typer.echo(generate_briefing(graph, backend, cfg, pipeline=pipeline))


@app.command()
def eval(
    config: Optional[Path] = ConfigOpt,
    gold: Optional[Path] = typer.Option(None, "--gold", help="Path to the gold-edge JSON."),
) -> None:
    """Score committed edges against the hand-labelled gold set."""
    from .evaluation import run_eval

    cfg = _cfg(config)
    _, gstore = _stores(cfg)
    graph = gstore.load()
    report = run_eval(graph, gold_path=str(gold) if gold else None)
    typer.echo(report.render())


@app.command()
def stats(config: Optional[Path] = ConfigOpt) -> None:
    """Print node/edge counts."""
    from collections import Counter

    cfg = _cfg(config)
    _, gstore = _stores(cfg)
    graph = gstore.load()
    nk = Counter(n.kind for n in graph.nodes.values())
    ek = Counter(e.type.value for e in graph.edges)
    typer.echo(f"nodes: {len(graph.nodes)}")
    for k, v in nk.most_common():
        typer.echo(f"  {k}: {v}")
    committed = sum(1 for e in graph.edges if e.status.value == "committed")
    typer.echo(f"edges: {len(graph.edges)} (committed={committed}, "
               f"hypothesis={len(graph.edges) - committed})")
    for k, v in ek.most_common():
        typer.echo(f"  {k}: {v}")


# --------------------------------------------------------------------------- #
# GitHub integration sub-app: `libbie github {login,repos,ingest}`
# --------------------------------------------------------------------------- #
github_app = typer.Typer(
    help="Authenticate to GitHub (device flow) and ingest any accessible repo.",
    no_args_is_help=True,
    add_completion=False,
)
app.add_typer(github_app, name="github")


@github_app.command("login")
def github_login(config: Optional[Path] = ConfigOpt) -> None:
    """Authenticate via GitHub OAuth device flow and store the token."""
    from . import github as gh

    client_id = gh.get_client_id()
    if not client_id:
        typer.echo(
            "No client id. Register a GitHub OAuth App (device flow enabled) and "
            "set $LIBBIE_GITHUB_CLIENT_ID.",
            err=True,
        )
        raise typer.Exit(1)

    try:
        device = gh.request_device_code(client_id, scope="repo")
    except Exception as exc:
        typer.echo(f"Could not start device flow: {exc}", err=True)
        raise typer.Exit(1)

    typer.echo(f"Open {device.verification_uri} and enter code: {device.user_code}")
    typer.echo("Waiting for authorization...")
    try:
        token = gh.poll_for_token(client_id, device.device_code, device.interval)
    except gh.DeviceFlowError as exc:
        typer.echo(f"Authorization failed: {exc}", err=True)
        raise typer.Exit(1)

    cfg = _cfg(config)
    gh.save_token(token, _store_root(cfg))
    typer.echo("Authenticated. Token stored securely (never logged).")


@github_app.command("repos")
def github_repos(config: Optional[Path] = ConfigOpt) -> None:
    """List repositories the stored token can access."""
    from . import github as gh

    cfg = _cfg(config)
    token = gh.load_token(_store_root(cfg))
    if not token:
        typer.echo("Not authenticated. Run `libbie github login` first.", err=True)
        raise typer.Exit(1)

    repos = gh.list_repos(token)
    if not repos:
        typer.echo(
            "No accessible repos. If you expect org private repos, the token may "
            "need SAML SSO authorization for that org."
        )
        return
    for r in repos:
        vis = "private" if r.private else "public"
        typer.echo(f"  {r.full_name:<45} {vis:<8} {r.description or ''}")


@github_app.command("ingest")
def github_ingest(
    repo: str = typer.Argument(..., help="Repository as owner/repo."),
    rev: Optional[str] = typer.Option(None, "--rev", help="Branch or tag to clone."),
    config: Optional[Path] = ConfigOpt,
) -> None:
    """Clone owner/repo into the store, ingest its history, and save the graph."""
    from . import github as gh
    from .ingest import ingest_git
    from .lazarus import annotate_environment

    cfg = _cfg(config)
    store, gstore = _stores(cfg)
    root = _store_root(cfg)

    token = gh.load_token(root)
    if not token:
        typer.echo("Not authenticated. Run `libbie github login` first.", err=True)
        raise typer.Exit(1)

    # App-controlled clone destination under the store (validated repo -> safe name).
    dest = root / "github" / repo.replace("/", "__")
    if dest.exists():
        import shutil

        shutil.rmtree(dest, ignore_errors=True)
    dest.parent.mkdir(parents=True, exist_ok=True)

    try:
        path = gh.clone_repo(repo, token, dest, rev=rev)
    except (ValueError, gh.GitHubError) as exc:
        typer.echo(f"Clone failed: {exc}", err=True)
        raise typer.Exit(1)

    graph = gstore.load()
    nodes = ingest_git(str(path), store=store)
    for n in nodes:
        graph.add_node(n)
    annotate_environment(graph)
    gstore.save(graph)
    typer.echo(
        f"Ingested {len(nodes)} nodes from {repo}. "
        f"Graph now has {len(graph.nodes)} nodes."
    )


def main() -> None:
    # The briefing uses real typography (em dash, section sign, smart quotes);
    # make sure it survives on a Windows console / when redirected to a file.
    import sys

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass
    app()


if __name__ == "__main__":
    main()

//! Tauri command surface — the typed bridge the TypeScript client calls.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::config::{self, AppConfig};
use crate::email::{self, EmailFolder, ImapConfig};
use crate::engine::{self, EngineChoice, EngineManager, EngineStatus, HardwareInfo};
use crate::error::AppError;
use crate::github::{self, Repo};
use crate::inference::{self, ChatMessage, ChatOptions, StreamEvent};
use crate::oauth;
use crate::slack::{self, SlackChannel};
use crate::vecstore::{Hit, IndexedChunk, VecStore};

/// Shared application state held by Tauri.
pub struct AppState {
    pub engine: Arc<EngineManager>,
    pub config: Mutex<AppConfig>,
    /// The on-disk vector index. `None` when it could not be opened (corrupt/
    /// locked file, unwritable data dir) — the app still launches and retrieval
    /// degrades to lexical-only rather than crashing on startup.
    pub vec: Option<VecStore>,
}

impl AppState {
    pub fn new() -> Self {
        let vec = match VecStore::open(config::index_db_path()) {
            Ok(store) => Some(store),
            Err(e) => {
                // Non-fatal: log and continue. `vector_search`/`build_index` will
                // report VectorStoreUnavailable so the frontend falls back to
                // lexical retrieval (see rag.ts `retrieveVector`).
                eprintln!(
                    "libbie: vector index unavailable, falling back to lexical retrieval only: {}",
                    e
                );
                None
            }
        };
        AppState {
            engine: EngineManager::new(),
            config: Mutex::new(config::load()),
            vec,
        }
    }

    /// Borrow the vector store, or a typed "unavailable" error the frontend can
    /// recognise and recover from (lexical fallback).
    fn vec(&self) -> Result<&VecStore, AppError> {
        self.vec.as_ref().ok_or_else(|| {
            AppError::vector_store_unavailable(
                "The vector index is unavailable on this host; using lexical retrieval instead.",
            )
        })
    }
}

/// A GGUF model discovered in the local cache directory.
#[derive(Debug, Clone, Serialize)]
pub struct ModelEntry {
    pub name: String,
    pub path: String,
    pub size_mb: u64,
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, AppError> {
    // Never hand secrets (API keys, github token) to the untrusted webview.
    Ok(state.config.lock().await.redacted())
}

#[tauri::command]
pub async fn set_config(
    state: State<'_, AppState>,
    mut config: AppConfig,
) -> Result<AppConfig, AppError> {
    // The webview only ever sees masked secrets, so merge the stored real values
    // back in (SECRET_SENTINEL = unchanged), then validate the air-gap invariants
    // (loopback host, recognised engine binary) before persisting.
    {
        let current = state.config.lock().await;
        config.merge_secrets_from(&current);
    }
    config.validate().map_err(AppError::invalid_input)?;
    config::save(&config).map_err(|e| AppError::config(format!("Could not save config: {e}")))?;
    *state.config.lock().await = config.clone();
    Ok(config.redacted())
}

#[tauri::command]
pub fn get_hardware() -> HardwareInfo {
    engine::detect_hardware()
}

#[tauri::command]
pub async fn get_engine_choice(state: State<'_, AppState>) -> Result<EngineChoice, AppError> {
    let cfg = state.config.lock().await.clone();
    Ok(engine::choose_engine(&engine::detect_hardware(), &cfg))
}

#[tauri::command]
pub async fn engine_status(state: State<'_, AppState>) -> Result<EngineStatus, AppError> {
    Ok(state.engine.status().await)
}

#[tauri::command]
pub async fn start_engine(state: State<'_, AppState>) -> Result<EngineStatus, AppError> {
    let cfg = state.config.lock().await.clone();
    state.engine.start(&cfg).await
}

#[tauri::command]
pub async fn stop_engine(state: State<'_, AppState>) -> Result<(), AppError> {
    state.engine.stop().await;
    Ok(())
}

/// List GGUF models in the configured cache directory.
#[tauri::command]
pub async fn list_models(state: State<'_, AppState>) -> Result<Vec<ModelEntry>, AppError> {
    let cfg = state.config.lock().await.clone();
    let dir = std::path::PathBuf::from(&cfg.models_dir);
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_gguf = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("gguf"))
                .unwrap_or(false);
            if is_gguf {
                let size_mb = entry.metadata().map(|m| m.len() / 1024 / 1024).unwrap_or(0);
                out.push(ModelEntry {
                    name: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("model.gguf")
                        .to_string(),
                    path: path.to_string_lossy().to_string(),
                    size_mb,
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Open the native file picker (IN RUST) and return the chosen `.json` graph's
/// contents. Returns `None` if the user cancels.
///
/// SECURITY: the path is chosen by the user in the OS dialog and never leaves
/// Rust, so the untrusted webview cannot supply an arbitrary path. (An earlier
/// design took a `path` argument from JS, which let a compromised webview read
/// any `.json` on disk — including the app's own `config.json` of plaintext
/// secrets. Do not reintroduce a path parameter.) Plain local read, no network,
/// so it works in strict air-gapped mode.
#[tauri::command]
pub async fn open_graph_json(app: tauri::AppHandle) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Graph JSON", &["json"])
        .pick_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx
        .await
        .map_err(|_| AppError::config("The file dialog was dismissed."))?;
    let Some(file_path) = picked else {
        return Ok(None); // user cancelled
    };
    let path = file_path
        .into_path()
        .map_err(|e| AppError::config(format!("Invalid file path: {e}")))?;
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| AppError::config(format!("Could not read graph file: {e}")))?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err(AppError::invalid_input("Graph file is too large (>64 MB)."));
    }
    tokio::fs::read_to_string(&path)
        .await
        .map(Some)
        .map_err(|e| AppError::config(format!("Could not read graph file: {e}")))
}

/// Stream a grounded chat completion from the local engine.
///
/// The frontend assembles the RAG-grounded messages (system + retrieved context
/// + question) and passes them here; Rust proxies the OpenAI-compatible stream
/// and pushes token deltas back over `on_event`.
#[tauri::command]
pub async fn ask_libbie(
    state: State<'_, AppState>,
    messages: Vec<ChatMessage>,
    options: Option<ChatOptions>,
    on_event: Channel<StreamEvent>,
) -> Result<(), AppError> {
    let target = {
        let cfg = state.config.lock().await;
        cfg.chat_target()
    };
    let client = state.engine.client();
    let opts = options.unwrap_or_default();

    if let Err(e) = inference::stream_chat(&client, &target, messages, opts, &on_event).await {
        let _ = on_event.send(StreamEvent::Error {
            message: e.message().to_string(),
        });
        return Err(e);
    }
    Ok(())
}

/// Compute embeddings for RAG indexing (requires an embedding engine running on
/// `embed_port`). Returns one vector per input.
#[tauri::command]
pub async fn embed_texts(
    state: State<'_, AppState>,
    inputs: Vec<String>,
) -> Result<Vec<Vec<f32>>, AppError> {
    let target = {
        let cfg = state.config.lock().await;
        cfg.embed_target()
    };
    let client = state.engine.client();
    inference::embed(&client, &target, inputs).await
}

// ---- embedding engine lifecycle ------------------------------------------

#[tauri::command]
pub async fn start_embed_engine(state: State<'_, AppState>) -> Result<EngineStatus, AppError> {
    let cfg = state.config.lock().await.clone();
    state.engine.start_embed(&cfg).await
}

#[tauri::command]
pub async fn stop_embed_engine(state: State<'_, AppState>) -> Result<(), AppError> {
    state.engine.stop_embed().await;
    Ok(())
}

#[tauri::command]
pub async fn embed_engine_status(state: State<'_, AppState>) -> Result<EngineStatus, AppError> {
    Ok(state.engine.embed_status().await)
}

// ---- vector index ---------------------------------------------------------

/// A corpus chunk to embed and index. Text is embedded; the rest is citation
/// metadata carried straight into the vec0 table.
#[derive(Debug, Clone, Deserialize)]
pub struct Chunk {
    pub text: String,
    pub path: Option<String>,
    pub kind: String,
    pub line_start: i64,
    pub conv_id: Option<String>,
}

/// Stable, dependency-free FNV-1a identity for a chunk within a source.  The
/// source namespace is stored separately; these fields distinguish a remote
/// record/path and make changed content produce a new identity.
fn stable_chunk_id(chunk: &Chunk) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    let line_start = chunk.line_start.to_string();
    for field in [
        chunk.path.as_deref().unwrap_or(""),
        &chunk.kind,
        &line_start,
        chunk.conv_id.as_deref().unwrap_or(""),
        &chunk.text,
    ] {
        for byte in field
            .as_bytes()
            .iter()
            .copied()
            .chain(std::iter::once(0xff))
        {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("{hash:016x}")
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexStatus {
    pub indexed: bool,
    pub count: i64,
    pub dim: Option<usize>,
}

/// Both evidence legs from one query embedding. Keeping this as one IPC call
/// avoids paying the embedding-engine round trip once per kind.
#[derive(Debug, Clone, Serialize)]
pub struct VectorRetrieval {
    pub code_hits: Vec<Hit>,
    pub conversation_hits: Vec<Hit>,
}

#[tauri::command]
pub async fn index_status(state: State<'_, AppState>) -> Result<IndexStatus, AppError> {
    // A missing store is reported as "not indexed" rather than an error, so the
    // UI can show a clean degraded state instead of a failure.
    let Some(vec) = state.vec.as_ref() else {
        return Ok(IndexStatus {
            indexed: false,
            count: 0,
            dim: None,
        });
    };
    let count = vec.count();
    Ok(IndexStatus {
        indexed: count > 0,
        count,
        dim: vec.dim(),
    })
}

/// Embed a set of chunks (documents prefixed for nomic) and atomically replace
/// just one source in the shared vec0 index. All embedding happens in Rust via the resolved embedding target
/// (loopback for local). `on_progress(done, total)` is called after each batch
/// so callers can surface progress; pass a no-op when unused. Shared by
/// `build_index` and `github_index_repo` so the embed/index logic lives once.
async fn embed_and_index<F: FnMut(usize, usize)>(
    state: &AppState,
    source_id: &str,
    chunks: &[Chunk],
    mut on_progress: F,
) -> Result<IndexStatus, AppError> {
    let vec = state.vec()?;
    if chunks.is_empty() {
        return Err(AppError::invalid_input("No chunks to index."));
    }
    let target = {
        let cfg = state.config.lock().await;
        cfg.embed_target()
    };
    let client = state.engine.client();

    // Embed in modest batches so a large corpus doesn't overrun the engine batch.
    let mut embeddings: Vec<Vec<f32>> = Vec::with_capacity(chunks.len());
    for batch in chunks.chunks(16) {
        let inputs: Vec<String> = batch
            .iter()
            .map(|c| format!("search_document: {}", c.text))
            .collect();
        let vecs = inference::embed(&client, &target, inputs).await?;
        if vecs.len() != batch.len() {
            return Err(AppError::embedding(
                "Embedding engine returned the wrong number of vectors.",
            ));
        }
        embeddings.extend(vecs);
        on_progress(embeddings.len(), chunks.len());
    }

    let dim = embeddings
        .first()
        .map(|v| v.len())
        .filter(|d| *d > 0)
        .ok_or_else(|| AppError::embedding("Embedding engine returned empty vectors."))?;

    let chunk_ids: Vec<String> = chunks.iter().map(stable_chunk_id).collect();
    let indexed: Vec<IndexedChunk<'_>> = chunks
        .iter()
        .zip(embeddings.iter())
        .zip(chunk_ids.iter())
        .map(|((chunk, embedding), chunk_id)| IndexedChunk {
            chunk_id,
            embedding,
            path: chunk.path.as_deref().unwrap_or(""),
            kind: &chunk.kind,
            line_start: chunk.line_start,
            conv_id: chunk.conv_id.as_deref().unwrap_or(""),
        })
        .collect();
    vec.replace_source(dim, source_id, &indexed)?;

    Ok(IndexStatus {
        indexed: true,
        count: chunks.len() as i64,
        dim: Some(dim),
    })
}

/// Embed the corpus (documents prefixed for nomic) and (re)build the vec0 index.
/// All embedding happens in Rust via the loopback embedding engine.
#[tauri::command]
pub async fn build_index(
    state: State<'_, AppState>,
    chunks: Vec<Chunk>,
) -> Result<IndexStatus, AppError> {
    embed_and_index(state.inner(), "manual", &chunks, |_, _| {}).await
}

/// Embed `query` (prefixed for nomic) and return the K nearest chunks, optionally
/// filtered to a kind ("code" | "conversation").
#[tauri::command]
pub async fn vector_search(
    state: State<'_, AppState>,
    query: String,
    k: usize,
    kind: Option<String>,
) -> Result<Vec<Hit>, AppError> {
    let store = state.vec()?;
    let target = {
        let cfg = state.config.lock().await;
        cfg.embed_target()
    };
    let client = state.engine.client();
    let q = format!("search_query: {}", query);
    let vecs = inference::embed(&client, &target, vec![q]).await?;
    let emb = vecs
        .into_iter()
        .next()
        .ok_or_else(|| AppError::embedding("No query embedding returned."))?;
    store.knn(&emb, k, kind.as_deref())
}

/// Embed `query` once, then search both citation kinds against that same vector.
#[tauri::command]
pub async fn retrieve_vector(
    state: State<'_, AppState>,
    query: String,
    code_k: usize,
    conversation_k: usize,
) -> Result<VectorRetrieval, AppError> {
    let store = state.vec()?;
    let target = {
        let cfg = state.config.lock().await;
        cfg.embed_target()
    };
    let client = state.engine.client();
    let vecs = inference::embed(&client, &target, vec![format!("search_query: {query}")]).await?;
    let emb = vecs
        .into_iter()
        .next()
        .ok_or_else(|| AppError::embedding("No query embedding returned."))?;
    Ok(VectorRetrieval {
        code_hits: store.knn(&emb, code_k, Some("code"))?,
        conversation_hits: store.knn(&emb, conversation_k, Some("conversation"))?,
    })
}

// ---- HuggingFace model download -------------------------------------------

/// A downloadable GGUF file discovered in a HuggingFace repo.
#[derive(Debug, Clone, Serialize)]
pub struct HfFile {
    pub path: String,
    pub size_mb: u64,
}

/// Progress events for a streamed model download.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DownloadEvent {
    Progress {
        downloaded: u64,
        total: u64,
        fraction: f64,
    },
    Done {
        path: String,
    },
    Error {
        message: String,
    },
}

/// List the `.gguf` files in a HuggingFace repo via the Hub tree API.
/// `token` is optional (only needed for gated/private repos).
#[tauri::command]
pub async fn list_hf_gguf(
    state: State<'_, AppState>,
    repo: String,
    revision: Option<String>,
    token: Option<String>,
) -> Result<Vec<HfFile>, AppError> {
    let rev = revision.unwrap_or_else(|| "main".to_string());
    let url = format!("https://huggingface.co/api/models/{repo}/tree/{rev}?recursive=true");
    let mut req = state.engine.client().get(&url);
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::engine_unreachable(format!("Could not reach HuggingFace: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::engine_error(format!(
            "HuggingFace returned {} for {repo}",
            resp.status()
        )));
    }
    let items: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| AppError::engine_error(format!("Bad HuggingFace response: {e}")))?;
    let mut out: Vec<HfFile> = items
        .into_iter()
        .filter(|it| it.get("type").and_then(|t| t.as_str()) == Some("file"))
        .filter_map(|it| {
            let path = it.get("path").and_then(|p| p.as_str())?.to_string();
            if !path.to_ascii_lowercase().ends_with(".gguf") {
                return None;
            }
            let size = it.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
            Some(HfFile {
                path,
                size_mb: size / 1024 / 1024,
            })
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Stream-download a GGUF from HuggingFace into the models directory, emitting
/// progress. Blocked in strict air-gapped mode (no runtime egress).
#[tauri::command]
pub async fn download_model(
    state: State<'_, AppState>,
    repo: String,
    filename: String,
    revision: Option<String>,
    token: Option<String>,
    on_progress: Channel<DownloadEvent>,
) -> Result<String, AppError> {
    let (models_dir, offline) = {
        let cfg = state.config.lock().await;
        (cfg.models_dir.clone(), cfg.offline_mode)
    };
    if offline {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — downloads are disabled. Turn off \
             air-gap to download, or stage the .gguf into the models folder manually.",
        ));
    }

    // Destination is a plain basename in the models dir (no path traversal).
    let base = Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::invalid_input("Invalid filename."))?;
    if !base.to_ascii_lowercase().ends_with(".gguf") {
        return Err(AppError::invalid_input(
            "Only .gguf files can be downloaded.",
        ));
    }
    let dir = PathBuf::from(&models_dir);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::config(format!("Could not create models dir: {e}")))?;
    let dest = dir.join(base);

    let rev = revision.unwrap_or_else(|| "main".to_string());
    // Host is fixed to huggingface.co; repo/filename are only path segments.
    let url = format!("https://huggingface.co/{repo}/resolve/{rev}/{filename}");
    let mut req = state.engine.client().get(&url);
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }

    let result = stream_to_file(req, &dest, &on_progress).await;
    match result {
        Ok(()) => {
            let path = dest.to_string_lossy().to_string();
            let _ = on_progress.send(DownloadEvent::Done { path: path.clone() });
            Ok(path)
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&dest).await; // don't leave a partial file
            let _ = on_progress.send(DownloadEvent::Error {
                message: e.message().to_string(),
            });
            Err(e)
        }
    }
}

async fn stream_to_file(
    req: reqwest::RequestBuilder,
    dest: &Path,
    on_progress: &Channel<DownloadEvent>,
) -> Result<(), AppError> {
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::engine_unreachable(format!("Could not reach HuggingFace: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::engine_error(format!(
            "HuggingFace returned {}",
            resp.status()
        )));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| AppError::config(format!("Could not create file: {e}")))?;
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| AppError::engine_error(format!("Download error: {e}")))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| AppError::config(format!("Write error: {e}")))?;
        downloaded += bytes.len() as u64;
        let fraction = if total > 0 {
            downloaded as f64 / total as f64
        } else {
            0.0
        };
        let _ = on_progress.send(DownloadEvent::Progress {
            downloaded,
            total,
            fraction,
        });
    }
    file.flush()
        .await
        .map_err(|e| AppError::config(format!("Flush error: {e}")))?;
    Ok(())
}

// ---- GitHub integration ----------------------------------------------------

/// Progress events for the GitHub OAuth device flow.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GithubLoginEvent {
    /// The user code + verification URL to display; the user enters the code there.
    Code {
        user_code: String,
        verification_uri: String,
        expires_in: u64,
    },
    /// Authorization succeeded and the token was stored.
    Done,
    /// The flow failed (denied, expired, network, …).
    Error { message: String },
}

/// Progress events for cloning + indexing a repository.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum IndexEvent {
    /// A human-readable phase update (cloning, scanning, …).
    Status { message: String },
    /// Embedding progress over the collected chunks.
    Progress {
        done: usize,
        total: usize,
        fraction: f64,
    },
    /// Indexing finished; `count` chunks are now searchable.
    Done { count: i64 },
    /// The operation failed.
    Error { message: String },
}

/// File extensions worth indexing (code + text + docs). Anything else is skipped.
const INDEXABLE_EXTS: &[&str] = &[
    "rs",
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "py",
    "go",
    "java",
    "kt",
    "kts",
    "c",
    "cc",
    "cpp",
    "cxx",
    "h",
    "hpp",
    "hh",
    "cs",
    "rb",
    "php",
    "swift",
    "scala",
    "sh",
    "bash",
    "zsh",
    "ps1",
    "sql",
    "r",
    "jl",
    "lua",
    "pl",
    "pm",
    "ex",
    "exs",
    "erl",
    "clj",
    "hs",
    "ml",
    "dart",
    "vue",
    "svelte",
    "css",
    "scss",
    "sass",
    "less",
    "html",
    "htm",
    "xml",
    "json",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "config",
    "properties",
    "env",
    "md",
    "mdx",
    "markdown",
    "rst",
    "txt",
    "text",
    "nf",
    "nextflow",
    "wdl",
    "cwl",
    "snakefile",
    "dockerfile",
    "makefile",
    "cmake",
    "gradle",
    "tf",
    "hcl",
    "proto",
    "graphql",
    "gql",
];

/// Directories to skip entirely during the walk (VCS, deps, build output).
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".venv",
    "venv",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    "vendor",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".gradle",
    ".idea",
    ".vscode",
    "coverage",
    ".cache",
];

const MAX_FILE_BYTES: u64 = 512 * 1024; // skip files larger than ~512 KB
const MAX_FILES: usize = 4000; // cap total files indexed from one repo
const MAX_TOTAL_BYTES: usize = 64 * 1024 * 1024; // aggregate cap: bound peak memory
const CHUNK_LINES: usize = 120; // window large files into ~120-line chunks

/// True when a file's name/extension marks it as indexable text.
fn is_indexable_file(path: &Path) -> bool {
    // Extension-less files with well-known names (Dockerfile, Makefile, …).
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if INDEXABLE_EXTS.contains(&name.as_str()) {
        return true;
    }
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => INDEXABLE_EXTS.contains(&ext.to_ascii_lowercase().as_str()),
        None => false,
    }
}

/// Walk a cloned repo and build `Chunk` records: one per ~120-line window of each
/// indexable text file, carrying its repo-relative path + starting line for
/// citation. Skips `.git`, dependency/build dirs, binaries (non-UTF-8), files over
/// ~512 KB, and caps the total file count.
fn collect_repo_chunks(root: &Path) -> Vec<Chunk> {
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut files_seen: usize = 0;
    let mut total_bytes: usize = 0;
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if files_seen >= MAX_FILES {
                return chunks;
            }
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !file_type.is_file() || !is_indexable_file(&path) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
            // Non-UTF-8 (binary) files fail here and are skipped.
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            files_seen += 1;
            // Aggregate byte budget: stop before peak memory gets out of hand on a
            // pathological repo (many near-max files), independent of the file count.
            total_bytes += text.len();
            if total_bytes > MAX_TOTAL_BYTES {
                return chunks;
            }

            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let lines: Vec<&str> = text.lines().collect();
            let mut start = 0;
            while start < lines.len() {
                let end = (start + CHUNK_LINES).min(lines.len());
                let body = lines[start..end].join("\n");
                if body.trim().len() >= 3 {
                    chunks.push(Chunk {
                        text: format!("{rel}\n{body}"),
                        path: Some(rel.clone()),
                        kind: "code".to_string(),
                        line_start: start as i64 + 1,
                        conv_id: None,
                    });
                }
                start = end;
            }
        }
    }
    chunks
}

/// Resolve the OAuth App client id: config field first, then the
/// `LIBBIE_GITHUB_CLIENT_ID` environment variable.
fn resolve_client_id(cfg: &AppConfig) -> Option<String> {
    let from_cfg = cfg.github_client_id.trim();
    if !from_cfg.is_empty() {
        return Some(from_cfg.to_string());
    }
    std::env::var("LIBBIE_GITHUB_CLIENT_ID")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Run the GitHub OAuth device flow, emitting the user code then success/failure.
/// On success the access token is persisted to config (never logged).
#[tauri::command]
pub async fn github_login(
    state: State<'_, AppState>,
    on_event: Channel<GithubLoginEvent>,
) -> Result<(), AppError> {
    let result = github_login_inner(&state, &on_event).await;
    if let Err(ref e) = result {
        let _ = on_event.send(GithubLoginEvent::Error {
            message: e.message().to_string(),
        });
    }
    result
}

async fn github_login_inner(
    state: &AppState,
    on_event: &Channel<GithubLoginEvent>,
) -> Result<(), AppError> {
    let (offline, client_id) = {
        let cfg = state.config.lock().await;
        (cfg.offline_mode, resolve_client_id(&cfg))
    };
    if offline {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — GitHub access is disabled. \
             Turn off air-gap to connect your account.",
        ));
    }
    let client_id = client_id.ok_or_else(|| {
        AppError::config(
            "No GitHub client id configured. Set it in Settings (or the \
             LIBBIE_GITHUB_CLIENT_ID environment variable).",
        )
    })?;

    let client = state.engine.client();
    let dc = github::request_device_code(&client, &client_id)
        .await
        .map_err(AppError::github)?;
    let _ = on_event.send(GithubLoginEvent::Code {
        user_code: dc.user_code.clone(),
        verification_uri: dc.verification_uri.clone(),
        expires_in: dc.expires_in,
    });

    let token = github::poll_for_token(&client, &client_id, &dc.device_code, dc.interval)
        .await
        .map_err(AppError::github)?;

    {
        let mut cfg = state.config.lock().await;
        cfg.github_token = Some(token);
        config::save(&cfg)
            .map_err(|e| AppError::config(format!("Could not save GitHub token: {e}")))?;
    }
    let _ = on_event.send(GithubLoginEvent::Done);
    Ok(())
}

/// List every repository the connected GitHub account can access.
#[tauri::command]
pub async fn github_list_repos(state: State<'_, AppState>) -> Result<Vec<Repo>, AppError> {
    let (offline, token) = {
        let cfg = state.config.lock().await;
        (cfg.offline_mode, cfg.github_token.clone())
    };
    if offline {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — GitHub access is disabled.",
        ));
    }
    let token = token
        .ok_or_else(|| AppError::github("Not connected to GitHub. Connect your account first."))?;
    let client = state.engine.client();
    github::list_repos(&client, &token)
        .await
        .map_err(AppError::github)
}

/// Clone a repository (shallow) and index it into the RAG store, emitting
/// progress. Reuses the shared embed/index helper so the vector store is built
/// exactly as for the sample corpus.
#[tauri::command]
pub async fn github_index_repo(
    state: State<'_, AppState>,
    full_name: String,
    on_event: Channel<IndexEvent>,
) -> Result<IndexStatus, AppError> {
    let result = github_index_repo_inner(&state, &full_name, &on_event).await;
    if let Err(ref e) = result {
        let _ = on_event.send(IndexEvent::Error {
            message: e.message().to_string(),
        });
    }
    result
}

async fn github_index_repo_inner(
    state: &AppState,
    full_name: &str,
    on_event: &Channel<IndexEvent>,
) -> Result<IndexStatus, AppError> {
    let (offline, token) = {
        let cfg = state.config.lock().await;
        (cfg.offline_mode, cfg.github_token.clone())
    };
    if offline {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — GitHub access is disabled.",
        ));
    }
    let token = token
        .ok_or_else(|| AppError::github("Not connected to GitHub. Connect your account first."))?;

    // App-controlled, unique clone destination (git requires it not yet exist).
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let base = config::github_repos_dir();
    tokio::fs::create_dir_all(&base)
        .await
        .map_err(|e| AppError::config(format!("Could not create repo scratch dir: {e}")))?;
    let dest = base.join(format!("clone_{}_{}", std::process::id(), nanos));

    let _ = on_event.send(IndexEvent::Status {
        message: format!("Cloning {full_name}…"),
    });
    if let Err(e) = github::clone_repo(full_name, &token, &dest).await {
        let _ = tokio::fs::remove_dir_all(&dest).await; // remove any partial clone
        return Err(AppError::github(e));
    }

    let _ = on_event.send(IndexEvent::Status {
        message: "Scanning files…".to_string(),
    });
    let chunks = collect_repo_chunks(&dest);
    // The clone has been read into memory; remove it now (don't keep a copy).
    let _ = tokio::fs::remove_dir_all(&dest).await;

    if chunks.is_empty() {
        return Err(AppError::invalid_input(
            "No indexable text files were found in that repository.",
        ));
    }

    let ev = on_event.clone();
    let status = embed_and_index(
        state,
        &format!("github:{}", full_name.to_ascii_lowercase()),
        &chunks,
        move |done, total| {
            let fraction = if total > 0 {
                done as f64 / total as f64
            } else {
                0.0
            };
            let _ = ev.send(IndexEvent::Progress {
                done,
                total,
                fraction,
            });
        },
    )
    .await?;

    let _ = on_event.send(IndexEvent::Done {
        count: status.count,
    });
    Ok(status)
}

// ---- Slack + Email connectors ----------------------------------------------

/// How long the loopback listener waits for an OAuth redirect.
const OAUTH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// Progress events for an OAuth-style connect flow (Slack OAuth / Gmail).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ConnectEvent {
    /// Open this URL in the browser to authorize; the loopback catches the code.
    Url { url: String },
    /// Authorization succeeded and the token was stored.
    Done,
    /// The flow failed (denied, timed out, network, …).
    Error { message: String },
}

/// Resolve a value from a config field, falling back to an env var. Trimmed;
/// empty is treated as unset.
fn resolve_str(from_cfg: &str, env_key: &str) -> Option<String> {
    let c = from_cfg.trim();
    if !c.is_empty() {
        return Some(c.to_string());
    }
    std::env::var(env_key)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn resolve_opt(from_cfg: &Option<String>, env_key: &str) -> Option<String> {
    match from_cfg {
        Some(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        _ => std::env::var(env_key)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    }
}

/// The FIXED Slack redirect port (env override, else the digest default).
fn slack_redirect_port() -> u16 {
    std::env::var("LIBBIE_SLACK_REDIRECT_PORT")
        .ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
        .unwrap_or(slack::DEFAULT_REDIRECT_PORT)
}

/// Convert conversation messages to embedding chunks (kind = "conversation").
fn conversation_chunk(conv_id: String, text: String) -> Chunk {
    Chunk {
        text,
        path: None,
        kind: "conversation".to_string(),
        line_start: 0,
        conv_id: Some(conv_id),
    }
}

// ---- Slack -----------------------------------------------------------------

/// Connect a Slack account. With a pasted `token` we validate it via `auth.test`;
/// otherwise we run the OAuth v2 loopback flow (emitting the authorize URL, then
/// catching the code on the FIXED loopback port). The user token is stored in the
/// Rust core (never logged). Blocked in strict air-gapped mode.
#[tauri::command]
pub async fn slack_connect(
    state: State<'_, AppState>,
    token: Option<String>,
    on_event: Channel<ConnectEvent>,
) -> Result<(), AppError> {
    let result = slack_connect_inner(&state, token, &on_event).await;
    if let Err(ref e) = result {
        let _ = on_event.send(ConnectEvent::Error {
            message: e.message().to_string(),
        });
    }
    result
}

async fn slack_connect_inner(
    state: &AppState,
    token: Option<String>,
    on_event: &Channel<ConnectEvent>,
) -> Result<(), AppError> {
    if state.config.lock().await.offline_mode {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — Slack access is disabled. \
             Turn off air-gap to connect your account.",
        ));
    }
    let client = state.engine.client();

    // Token-paste path: validate and store, no browser round-trip.
    if let Some(tok) = token
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
    {
        slack::auth_test(&client, &tok)
            .await
            .map_err(AppError::slack)?;
        let mut cfg = state.config.lock().await;
        cfg.slack_token = Some(tok);
        config::save(&cfg)
            .map_err(|e| AppError::config(format!("Could not save Slack token: {e}")))?;
        let _ = on_event.send(ConnectEvent::Done);
        return Ok(());
    }

    // OAuth v2 loopback path.
    let (client_id, client_secret) = {
        let cfg = state.config.lock().await;
        (
            resolve_str(&cfg.slack_client_id, "LIBBIE_SLACK_CLIENT_ID"),
            resolve_opt(&cfg.slack_client_secret, "LIBBIE_SLACK_CLIENT_SECRET"),
        )
    };
    let client_id = client_id.ok_or_else(|| {
        AppError::slack(
            "Paste a Slack user token, or set a Slack OAuth client id (and secret) \
             to connect via the browser.",
        )
    })?;
    let client_secret = client_secret.ok_or_else(|| {
        AppError::slack("Slack OAuth needs a client secret (LIBBIE_SLACK_CLIENT_SECRET).")
    })?;

    let port = slack_redirect_port();
    let csrf = oauth::random_state();
    let url = slack::build_authorize_url(&client_id, port, &csrf);
    let _ = on_event.send(ConnectEvent::Url { url });

    // The loopback listener binds the FIXED port and blocks, so run it off the
    // async runtime.
    let csrf_moved = csrf.clone();
    let code = tokio::task::spawn_blocking(move || {
        slack::catch_oauth_code(port, &csrf_moved, OAUTH_TIMEOUT)
    })
    .await
    .map_err(|e| AppError::slack(format!("Loopback task failed: {e}")))?
    .map_err(AppError::slack)?;

    let token = slack::exchange_code(&client, &client_id, &client_secret, &code, port)
        .await
        .map_err(AppError::slack)?;

    {
        let mut cfg = state.config.lock().await;
        cfg.slack_token = Some(token);
        config::save(&cfg)
            .map_err(|e| AppError::config(format!("Could not save Slack token: {e}")))?;
    }
    let _ = on_event.send(ConnectEvent::Done);
    Ok(())
}

/// List every Slack conversation the connected token can read.
#[tauri::command]
pub async fn slack_list_channels(
    state: State<'_, AppState>,
) -> Result<Vec<SlackChannel>, AppError> {
    let (offline, token) = {
        let cfg = state.config.lock().await;
        (cfg.offline_mode, cfg.slack_token.clone())
    };
    if offline {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — Slack access is disabled.",
        ));
    }
    let token = token
        .ok_or_else(|| AppError::slack("Not connected to Slack. Connect your account first."))?;
    let client = state.engine.client();
    slack::list_channels(&client, &token)
        .await
        .map_err(AppError::slack)
}

/// Fetch history for the selected conversations and index them into the RAG store,
/// emitting progress. Reuses the shared embed/index helper.
#[tauri::command]
pub async fn slack_index_channels(
    state: State<'_, AppState>,
    ids: Vec<String>,
    on_event: Channel<IndexEvent>,
) -> Result<IndexStatus, AppError> {
    let result = slack_index_inner(&state, &ids, &on_event).await;
    if let Err(ref e) = result {
        let _ = on_event.send(IndexEvent::Error {
            message: e.message().to_string(),
        });
    }
    result
}

async fn slack_index_inner(
    state: &AppState,
    ids: &[String],
    on_event: &Channel<IndexEvent>,
) -> Result<IndexStatus, AppError> {
    let (offline, token) = {
        let cfg = state.config.lock().await;
        (cfg.offline_mode, cfg.slack_token.clone())
    };
    if offline {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — Slack access is disabled.",
        ));
    }
    let token = token
        .ok_or_else(|| AppError::slack("Not connected to Slack. Connect your account first."))?;
    if ids.is_empty() {
        return Err(AppError::invalid_input(
            "Pick at least one channel to index.",
        ));
    }
    let client = state.engine.client();

    let _ = on_event.send(IndexEvent::Status {
        message: "Loading channel list…".to_string(),
    });
    let channels = slack::list_channels(&client, &token)
        .await
        .map_err(AppError::slack)?;
    let by_id: std::collections::HashMap<&str, &SlackChannel> =
        channels.iter().map(|c| (c.id.as_str(), c)).collect();

    let _ = on_event.send(IndexEvent::Status {
        message: "Resolving user names…".to_string(),
    });
    let users = slack::user_directory(&client, &token)
        .await
        .unwrap_or_default();

    let mut chunks: Vec<Chunk> = Vec::new();
    for id in ids {
        let Some(channel) = by_id.get(id.as_str()) else {
            continue;
        };
        let label = if channel.is_im {
            channel.name.clone()
        } else {
            format!("#{}", channel.name)
        };
        let _ = on_event.send(IndexEvent::Status {
            message: format!("Fetching {label}…"),
        });
        let msgs = slack::fetch_history(&client, &token, id)
            .await
            .map_err(AppError::slack)?;
        for m in &msgs {
            let (conv_id, text) = slack::message_chunk(channel, &users, m);
            chunks.push(conversation_chunk(conv_id, text));
        }
    }

    if chunks.is_empty() {
        return Err(AppError::invalid_input(
            "No messages were found in the selected channels.",
        ));
    }

    let ev = on_event.clone();
    let status = embed_and_index(state, "slack", &chunks, move |done, total| {
        let fraction = if total > 0 {
            done as f64 / total as f64
        } else {
            0.0
        };
        let _ = ev.send(IndexEvent::Progress {
            done,
            total,
            fraction,
        });
    })
    .await?;

    let _ = on_event.send(IndexEvent::Done {
        count: status.count,
    });
    Ok(status)
}

// ---- Email: Gmail ----------------------------------------------------------

/// Connect Gmail via the OAuth loopback (installed-app + PKCE). Emits the consent
/// URL, catches the code on an ephemeral loopback port, exchanges it, and stores
/// the access token in the Rust core (never logged). Blocked in air-gapped mode.
#[tauri::command]
pub async fn email_gmail_connect(
    state: State<'_, AppState>,
    on_event: Channel<ConnectEvent>,
) -> Result<(), AppError> {
    let result = email_gmail_connect_inner(&state, &on_event).await;
    if let Err(ref e) = result {
        let _ = on_event.send(ConnectEvent::Error {
            message: e.message().to_string(),
        });
    }
    result
}

async fn email_gmail_connect_inner(
    state: &AppState,
    on_event: &Channel<ConnectEvent>,
) -> Result<(), AppError> {
    let (offline, client_id, client_secret) = {
        let cfg = state.config.lock().await;
        (
            cfg.offline_mode,
            resolve_str(&cfg.gmail_client_id, "LIBBIE_GMAIL_CLIENT_ID"),
            resolve_opt(&cfg.gmail_client_secret, "LIBBIE_GMAIL_CLIENT_SECRET"),
        )
    };
    if offline {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — Gmail access is disabled. \
             Turn off air-gap to connect your account.",
        ));
    }
    let client_id = client_id.ok_or_else(|| {
        AppError::email(
            "No Gmail OAuth client id configured. Set it in Settings (or the \
             LIBBIE_GMAIL_CLIENT_ID environment variable).",
        )
    })?;

    let (server, port) = oauth::bind_ephemeral().map_err(AppError::email)?;
    let pkce = oauth::pkce();
    let csrf = oauth::random_state();
    let url = email::build_gmail_authorize_url(&client_id, port, &csrf, &pkce.challenge);
    let _ = on_event.send(ConnectEvent::Url { url });

    let csrf_moved = csrf.clone();
    let code = tokio::task::spawn_blocking(move || {
        oauth::recv_oauth_code(server, &csrf_moved, OAUTH_TIMEOUT)
    })
    .await
    .map_err(|e| AppError::email(format!("Loopback task failed: {e}")))?
    .map_err(AppError::email)?;

    let client = state.engine.client();
    let token = email::gmail_exchange_code(
        &client,
        &client_id,
        client_secret.as_deref(),
        &code,
        port,
        &pkce.verifier,
    )
    .await
    .map_err(AppError::email)?;

    {
        let mut cfg = state.config.lock().await;
        cfg.gmail_token = Some(token);
        config::save(&cfg)
            .map_err(|e| AppError::config(format!("Could not save Gmail token: {e}")))?;
    }
    let _ = on_event.send(ConnectEvent::Done);
    Ok(())
}

/// List Gmail labels for the connected account.
#[tauri::command]
pub async fn email_list_labels(state: State<'_, AppState>) -> Result<Vec<EmailFolder>, AppError> {
    let (offline, token) = {
        let cfg = state.config.lock().await;
        (cfg.offline_mode, cfg.gmail_token.clone())
    };
    if offline {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — Gmail access is disabled.",
        ));
    }
    let token = token
        .ok_or_else(|| AppError::email("Not connected to Gmail. Connect your account first."))?;
    let client = state.engine.client();
    email::gmail_list_labels(&client, &token)
        .await
        .map_err(AppError::email)
}

// ---- Email: IMAP -----------------------------------------------------------

/// Store IMAP credentials and verify them by connecting + listing mailboxes. The
/// app password is kept in the Rust core (never logged). Blocked in air-gapped
/// mode (IMAP is egress).
#[tauri::command]
pub async fn email_imap_connect(
    state: State<'_, AppState>,
    host: String,
    port: u16,
    user: String,
    password: Option<String>,
) -> Result<Vec<EmailFolder>, AppError> {
    if state.config.lock().await.offline_mode {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — IMAP access is disabled. \
             Turn off air-gap to connect a mailbox.",
        ));
    }
    let host = host.trim().to_string();
    let user = user.trim().to_string();
    if host.is_empty() || user.is_empty() {
        return Err(AppError::invalid_input("IMAP host and user are required."));
    }
    // A blank/sentinel password means "use the stored one".
    let password = match password.map(|p| p.trim().to_string()) {
        Some(p) if p == config::SECRET_SENTINEL || p.is_empty() => {
            state.config.lock().await.imap_password.clone()
        }
        Some(p) => Some(p),
        None => state.config.lock().await.imap_password.clone(),
    }
    .ok_or_else(|| AppError::invalid_input("An IMAP app password is required."))?;

    let cfg = ImapConfig {
        host: host.clone(),
        port,
        user: user.clone(),
        password: password.clone(),
    };
    // Verify before persisting.
    let mailboxes = email::imap_list_mailboxes(&cfg)
        .await
        .map_err(AppError::email)?;

    {
        let mut c = state.config.lock().await;
        c.imap_host = host;
        c.imap_port = port;
        c.imap_user = user;
        c.imap_password = Some(password);
        config::save(&c)
            .map_err(|e| AppError::config(format!("Could not save IMAP settings: {e}")))?;
    }
    Ok(mailboxes)
}

/// List mailboxes using the stored IMAP credentials.
#[tauri::command]
pub async fn email_list_mailboxes(
    state: State<'_, AppState>,
) -> Result<Vec<EmailFolder>, AppError> {
    let cfg = imap_config_from_state(state.inner()).await?;
    email::imap_list_mailboxes(&cfg)
        .await
        .map_err(AppError::email)
}

/// Build an `ImapConfig` from stored config, enforcing the air-gap and presence
/// of credentials.
async fn imap_config_from_state(state: &AppState) -> Result<ImapConfig, AppError> {
    let cfg = state.config.lock().await;
    if cfg.offline_mode {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — IMAP access is disabled.",
        ));
    }
    let password = cfg
        .imap_password
        .clone()
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::email("No IMAP mailbox connected. Connect one first."))?;
    if cfg.imap_host.trim().is_empty() || cfg.imap_user.trim().is_empty() {
        return Err(AppError::email(
            "No IMAP mailbox connected. Connect one first.",
        ));
    }
    Ok(ImapConfig {
        host: cfg.imap_host.clone(),
        port: cfg.imap_port,
        user: cfg.imap_user.clone(),
        password,
    })
}

// ---- Email: index ----------------------------------------------------------

/// Index the selected email folders into the RAG store. `source` is `"gmail"` or
/// `"imap"`; `folders` are Gmail label ids or IMAP mailbox names. Reuses the
/// shared embed/index helper.
#[tauri::command]
pub async fn email_index(
    state: State<'_, AppState>,
    source: String,
    folders: Vec<String>,
    on_event: Channel<IndexEvent>,
) -> Result<IndexStatus, AppError> {
    let result = email_index_inner(&state, &source, &folders, &on_event).await;
    if let Err(ref e) = result {
        let _ = on_event.send(IndexEvent::Error {
            message: e.message().to_string(),
        });
    }
    result
}

async fn email_index_inner(
    state: &AppState,
    source: &str,
    folders: &[String],
    on_event: &Channel<IndexEvent>,
) -> Result<IndexStatus, AppError> {
    if state.config.lock().await.offline_mode {
        return Err(AppError::airgap_blocked(
            "Strict air-gapped mode is on — email access is disabled.",
        ));
    }
    let chunks = match source {
        "gmail" => collect_gmail_chunks(state, folders, on_event).await?,
        "imap" => collect_imap_chunks(state, folders, on_event).await?,
        other => {
            return Err(AppError::invalid_input(format!(
                "Unknown email source {other:?} (expected 'gmail' or 'imap')."
            )))
        }
    };
    if chunks.is_empty() {
        return Err(AppError::invalid_input(
            "No messages were found in the selected folders.",
        ));
    }

    let ev = on_event.clone();
    let status = embed_and_index(state, source, &chunks, move |done, total| {
        let fraction = if total > 0 {
            done as f64 / total as f64
        } else {
            0.0
        };
        let _ = ev.send(IndexEvent::Progress {
            done,
            total,
            fraction,
        });
    })
    .await?;

    let _ = on_event.send(IndexEvent::Done {
        count: status.count,
    });
    Ok(status)
}

async fn collect_gmail_chunks(
    state: &AppState,
    labels: &[String],
    on_event: &Channel<IndexEvent>,
) -> Result<Vec<Chunk>, AppError> {
    let token = {
        let cfg = state.config.lock().await;
        cfg.gmail_token.clone()
    }
    .ok_or_else(|| AppError::email("Not connected to Gmail. Connect your account first."))?;
    let client = state.engine.client();

    // No label selected -> index across all mail.
    let selection: Vec<Option<String>> = if labels.is_empty() {
        vec![None]
    } else {
        labels.iter().map(|l| Some(l.clone())).collect()
    };

    let mut chunks: Vec<Chunk> = Vec::new();
    for label in selection {
        let _ = on_event.send(IndexEvent::Status {
            message: format!("Listing Gmail messages{}…", label_suffix(&label)),
        });
        let ids = email::gmail_list_message_ids(&client, &token, label.as_deref())
            .await
            .map_err(AppError::email)?;
        let total = ids.len();
        for (i, id) in ids.iter().enumerate() {
            let rec = email::gmail_get_message(&client, &token, id)
                .await
                .map_err(AppError::email)?;
            let (conv_id, text) = email::message_chunk(&rec);
            chunks.push(conversation_chunk(conv_id, text));
            if i % 25 == 0 {
                let _ = on_event.send(IndexEvent::Status {
                    message: format!("Fetched {}/{total} Gmail messages…", i + 1),
                });
            }
        }
    }
    Ok(chunks)
}

fn label_suffix(label: &Option<String>) -> String {
    match label {
        Some(l) => format!(" in {l}"),
        None => String::new(),
    }
}

async fn collect_imap_chunks(
    state: &AppState,
    mailboxes: &[String],
    on_event: &Channel<IndexEvent>,
) -> Result<Vec<Chunk>, AppError> {
    let cfg = imap_config_from_state(state).await?;
    if mailboxes.is_empty() {
        return Err(AppError::invalid_input(
            "Pick at least one mailbox to index.",
        ));
    }
    let mut chunks: Vec<Chunk> = Vec::new();
    for mbox in mailboxes {
        let _ = on_event.send(IndexEvent::Status {
            message: format!("Fetching mailbox {mbox}…"),
        });
        let records = email::imap_fetch(&cfg, mbox)
            .await
            .map_err(AppError::email)?;
        for rec in &records {
            let (conv_id, text) = email::message_chunk(rec);
            chunks.push(conversation_chunk(conv_id, text));
        }
    }
    Ok(chunks)
}

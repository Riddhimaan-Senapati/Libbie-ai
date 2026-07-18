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
use crate::engine::{self, EngineChoice, EngineManager, EngineStatus, HardwareInfo};
use crate::inference::{self, ChatMessage, ChatOptions, StreamEvent};
use crate::vecstore::{Hit, VecStore};

/// Shared application state held by Tauri.
pub struct AppState {
    pub engine: Arc<EngineManager>,
    pub config: Mutex<AppConfig>,
    pub vec: VecStore,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            engine: EngineManager::new(),
            config: Mutex::new(config::load()),
            vec: VecStore::open(config::index_db_path())
                .expect("failed to open vector index database"),
        }
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
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.lock().await.clone())
}

#[tauri::command]
pub async fn set_config(
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<AppConfig, String> {
    // The webview is untrusted: validate the air-gap invariants (loopback host,
    // recognised engine binary) before persisting or spawning anything with it.
    config.validate()?;
    config::save(&config).map_err(|e| format!("Could not save config: {e}"))?;
    *state.config.lock().await = config.clone();
    Ok(config)
}

#[tauri::command]
pub fn get_hardware() -> HardwareInfo {
    engine::detect_hardware()
}

#[tauri::command]
pub async fn get_engine_choice(state: State<'_, AppState>) -> Result<EngineChoice, String> {
    let cfg = state.config.lock().await.clone();
    Ok(engine::choose_engine(&engine::detect_hardware(), &cfg))
}

#[tauri::command]
pub async fn engine_status(state: State<'_, AppState>) -> Result<EngineStatus, String> {
    Ok(state.engine.status().await)
}

#[tauri::command]
pub async fn start_engine(state: State<'_, AppState>) -> Result<EngineStatus, String> {
    let cfg = state.config.lock().await.clone();
    state.engine.start(&cfg).await
}

#[tauri::command]
pub async fn stop_engine(state: State<'_, AppState>) -> Result<(), String> {
    state.engine.stop().await;
    Ok(())
}

/// List GGUF models in the configured cache directory.
#[tauri::command]
pub async fn list_models(state: State<'_, AppState>) -> Result<Vec<ModelEntry>, String> {
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
) -> Result<(), String> {
    let target = {
        let cfg = state.config.lock().await;
        cfg.chat_target()
    };
    let client = state.engine.client();
    let opts = options.unwrap_or_default();

    if let Err(e) = inference::stream_chat(&client, &target, messages, opts, &on_event).await {
        let _ = on_event.send(StreamEvent::Error { message: e.clone() });
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
) -> Result<Vec<Vec<f32>>, String> {
    let target = {
        let cfg = state.config.lock().await;
        cfg.embed_target()
    };
    let client = state.engine.client();
    inference::embed(&client, &target, inputs).await
}

// ---- embedding engine lifecycle ------------------------------------------

#[tauri::command]
pub async fn start_embed_engine(state: State<'_, AppState>) -> Result<EngineStatus, String> {
    let cfg = state.config.lock().await.clone();
    state.engine.start_embed(&cfg).await
}

#[tauri::command]
pub async fn stop_embed_engine(state: State<'_, AppState>) -> Result<(), String> {
    state.engine.stop_embed().await;
    Ok(())
}

#[tauri::command]
pub async fn embed_engine_status(state: State<'_, AppState>) -> Result<EngineStatus, String> {
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

#[derive(Debug, Clone, Serialize)]
pub struct IndexStatus {
    pub indexed: bool,
    pub count: i64,
    pub dim: Option<usize>,
}

#[tauri::command]
pub async fn index_status(state: State<'_, AppState>) -> Result<IndexStatus, String> {
    let count = state.vec.count();
    Ok(IndexStatus {
        indexed: count > 0,
        count,
        dim: state.vec.dim(),
    })
}

/// Embed the corpus (documents prefixed for nomic) and (re)build the vec0 index.
/// All embedding happens in Rust via the loopback embedding engine.
#[tauri::command]
pub async fn build_index(
    state: State<'_, AppState>,
    chunks: Vec<Chunk>,
) -> Result<IndexStatus, String> {
    if chunks.is_empty() {
        return Err("No chunks to index.".to_string());
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
            return Err("Embedding engine returned the wrong number of vectors.".to_string());
        }
        embeddings.extend(vecs);
    }

    let dim = embeddings
        .first()
        .map(|v| v.len())
        .filter(|d| *d > 0)
        .ok_or_else(|| "Embedding engine returned empty vectors.".to_string())?;

    state.vec.reset(dim)?;
    for (i, (c, emb)) in chunks.iter().zip(embeddings.iter()).enumerate() {
        state.vec.insert(
            i as i64 + 1,
            emb,
            c.path.as_deref().unwrap_or(""),
            &c.kind,
            c.line_start,
            c.conv_id.as_deref().unwrap_or(""),
        )?;
    }

    Ok(IndexStatus {
        indexed: true,
        count: chunks.len() as i64,
        dim: Some(dim),
    })
}

/// Embed `query` (prefixed for nomic) and return the K nearest chunks, optionally
/// filtered to a kind ("code" | "conversation").
#[tauri::command]
pub async fn vector_search(
    state: State<'_, AppState>,
    query: String,
    k: usize,
    kind: Option<String>,
) -> Result<Vec<Hit>, String> {
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
        .ok_or_else(|| "No query embedding returned.".to_string())?;
    state.vec.knn(&emb, k, kind.as_deref())
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
    Progress { downloaded: u64, total: u64, fraction: f64 },
    Done { path: String },
    Error { message: String },
}

/// List the `.gguf` files in a HuggingFace repo via the Hub tree API.
/// `token` is optional (only needed for gated/private repos).
#[tauri::command]
pub async fn list_hf_gguf(
    state: State<'_, AppState>,
    repo: String,
    revision: Option<String>,
    token: Option<String>,
) -> Result<Vec<HfFile>, String> {
    let rev = revision.unwrap_or_else(|| "main".to_string());
    let url = format!(
        "https://huggingface.co/api/models/{repo}/tree/{rev}?recursive=true"
    );
    let mut req = state.engine.client().get(&url);
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Could not reach HuggingFace: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HuggingFace returned {} for {repo}", resp.status()));
    }
    let items: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("Bad HuggingFace response: {e}"))?;
    let mut out: Vec<HfFile> = items
        .into_iter()
        .filter(|it| it.get("type").and_then(|t| t.as_str()) == Some("file"))
        .filter_map(|it| {
            let path = it.get("path").and_then(|p| p.as_str())?.to_string();
            if !path.to_ascii_lowercase().ends_with(".gguf") {
                return None;
            }
            let size = it.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
            Some(HfFile { path, size_mb: size / 1024 / 1024 })
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
) -> Result<String, String> {
    let (models_dir, offline) = {
        let cfg = state.config.lock().await;
        (cfg.models_dir.clone(), cfg.offline_mode)
    };
    if offline {
        return Err("Strict air-gapped mode is on — downloads are disabled. Turn off \
                    air-gap to download, or stage the .gguf into the models folder manually."
            .to_string());
    }

    // Destination is a plain basename in the models dir (no path traversal).
    let base = Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid filename.".to_string())?;
    if !base.to_ascii_lowercase().ends_with(".gguf") {
        return Err("Only .gguf files can be downloaded.".to_string());
    }
    let dir = PathBuf::from(&models_dir);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Could not create models dir: {e}"))?;
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
            let _ = on_progress.send(DownloadEvent::Error { message: e.clone() });
            Err(e)
        }
    }
}

async fn stream_to_file(
    req: reqwest::RequestBuilder,
    dest: &Path,
    on_progress: &Channel<DownloadEvent>,
) -> Result<(), String> {
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Could not reach HuggingFace: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HuggingFace returned {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("Could not create file: {e}"))?;
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Download error: {e}"))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += bytes.len() as u64;
        let fraction = if total > 0 { downloaded as f64 / total as f64 } else { 0.0 };
        let _ = on_progress.send(DownloadEvent::Progress { downloaded, total, fraction });
    }
    file.flush().await.map_err(|e| format!("Flush error: {e}"))?;
    Ok(())
}

//! Tauri command surface — the typed bridge the TypeScript client calls.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;
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
    let (base_url, offline) = {
        let cfg = state.config.lock().await;
        (cfg.chat_base_url(), cfg.offline_mode)
    };
    let client = state.engine.client();
    let opts = options.unwrap_or_default();

    if let Err(e) =
        inference::stream_chat(&client, &base_url, messages, opts, offline, &on_event).await
    {
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
    let (base_url, offline) = {
        let cfg = state.config.lock().await;
        (cfg.embed_base_url(), cfg.offline_mode)
    };
    let client = state.engine.client();
    inference::embed(&client, &base_url, inputs, offline).await
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
    let (base_url, offline) = {
        let cfg = state.config.lock().await;
        (cfg.embed_base_url(), cfg.offline_mode)
    };
    let client = state.engine.client();

    // Embed in modest batches so a large corpus doesn't overrun the engine batch.
    let mut embeddings: Vec<Vec<f32>> = Vec::with_capacity(chunks.len());
    for batch in chunks.chunks(16) {
        let inputs: Vec<String> = batch
            .iter()
            .map(|c| format!("search_document: {}", c.text))
            .collect();
        let vecs = inference::embed(&client, &base_url, inputs, offline).await?;
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
    let (base_url, offline) = {
        let cfg = state.config.lock().await;
        (cfg.embed_base_url(), cfg.offline_mode)
    };
    let client = state.engine.client();
    let q = format!("search_query: {}", query);
    let vecs = inference::embed(&client, &base_url, vec![q], offline).await?;
    let emb = vecs
        .into_iter()
        .next()
        .ok_or_else(|| "No query embedding returned.".to_string())?;
    state.vec.knn(&emb, k, kind.as_deref())
}

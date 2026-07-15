//! Persistent, on-disk configuration for the Libbie desktop client.
//!
//! Everything here is local: paths to the inference engine binaries, the model
//! cache directory, the chat/embedding model selections, and the air-gapped
//! (offline) switch. No secrets, no remote endpoints — by design, the only
//! network destinations this app ever talks to are `127.0.0.1` engine ports.

use serde::{Deserialize, Serialize};
use std::path::{Component, PathBuf};

/// Which inference engine the client should prefer.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PreferredEngine {
    /// Detect hardware and pick vLLM (Linux+NVIDIA) or llama.cpp otherwise.
    #[default]
    Auto,
    /// Force llama.cpp `llama-server` (GGUF).
    Llama,
    /// Force vLLM (Linux + NVIDIA CUDA only).
    Vllm,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    /// Absolute path to `llama-server` (`.exe` on Windows). Auto-detected on
    /// first run when possible.
    pub llama_binary: Option<String>,
    /// Absolute path to a vLLM launcher (`python -m vllm ...` wrapper or the
    /// `vllm` executable). Unused on macOS/Windows.
    pub vllm_binary: Option<String>,
    /// Directory holding pre-staged GGUF models (air-gapped cache).
    pub models_dir: String,
    /// Selected chat model — a filename inside `models_dir` or an absolute path.
    pub chat_model: Option<String>,
    /// Selected GGUF embedding model (defaults to nomic-embed-text when present).
    pub embed_model: Option<String>,
    /// Loopback host the engine binds to. Always local.
    pub host: String,
    /// Port for the chat completions engine.
    pub chat_port: u16,
    /// Port for the embeddings engine (a second llama-server instance).
    pub embed_port: u16,
    /// When true, the app refuses any non-loopback egress (strict air-gap).
    pub offline_mode: bool,
    /// GPU layers to offload (`-ngl`). -1 = auto/max.
    pub gpu_layers: i32,
    /// Context window size passed to the engine.
    pub ctx_size: u32,
    /// Engine preference.
    pub preferred_engine: PreferredEngine,

    // ---- vLLM (Linux + NVIDIA) --------------------------------------------
    /// Chat model for vLLM — a HuggingFace repo id or a local model directory
    /// (NOT a GGUF file; vLLM loads full/quantized HF weights).
    pub vllm_model: Option<String>,
    /// Fraction of GPU memory vLLM may use (`--gpu-memory-utilization`).
    pub vllm_gpu_mem_util: f32,
    /// Optional cap on context length (`--max-model-len`).
    pub vllm_max_model_len: Option<u32>,
    /// Optional quantization method (`--quantization`), e.g. "awq", "gptq", "fp8".
    pub vllm_quantization: Option<String>,
    /// Weights dtype (`--dtype`): "auto" | "half" | "bfloat16" | "float16" | "float32".
    pub vllm_dtype: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            llama_binary: detect_llama_binary().map(|p| p.to_string_lossy().to_string()),
            vllm_binary: None,
            models_dir: default_models_dir().to_string_lossy().to_string(),
            chat_model: None,
            embed_model: None,
            host: "127.0.0.1".to_string(),
            chat_port: 51820,
            embed_port: 51821,
            offline_mode: true,
            gpu_layers: -1,
            ctx_size: 8192,
            preferred_engine: PreferredEngine::Auto,
            vllm_model: None,
            vllm_gpu_mem_util: 0.90,
            vllm_max_model_len: None,
            vllm_quantization: None,
            vllm_dtype: "auto".to_string(),
        }
    }
}

impl AppConfig {
    /// The chat completions base URL (OpenAI-compatible), e.g.
    /// `http://127.0.0.1:51820`.
    pub fn chat_base_url(&self) -> String {
        format!("http://{}:{}", self.host, self.chat_port)
    }

    /// The embeddings base URL (second local engine instance).
    pub fn embed_base_url(&self) -> String {
        format!("http://{}:{}", self.host, self.embed_port)
    }

    /// Resolve a model selection (bare filename or absolute path) against the
    /// configured models directory.
    ///
    /// Absolute paths are honoured as-is (the user may point at a model anywhere
    /// on disk). A *relative* selection is confined to `models_dir`: any `..` or
    /// root/prefix components are stripped so a value like `../../etc/passwd`
    /// cannot escape the cache directory. This removes a traversal footgun ahead
    /// of any future config import/sharing feature.
    pub fn resolve_model(&self, sel: &str) -> PathBuf {
        let p = PathBuf::from(sel);
        if p.is_absolute() {
            return p;
        }
        let mut out = PathBuf::from(&self.models_dir);
        for comp in p.components() {
            // Keep only real path segments; drop `..`, `.`, and any root/prefix.
            if let Component::Normal(seg) = comp {
                out.push(seg);
            }
        }
        out
    }
}

/// Path to the persisted config file: `<config-dir>/Libbie/config.json`.
pub fn config_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("Libbie").join("config.json")
}

/// Default model cache: `<data-dir>/Libbie/models`.
pub fn default_models_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("Libbie").join("models")
}

/// On-disk vector index: `<data-dir>/Libbie/index.db`.
pub fn index_db_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("Libbie").join("index.db")
}

/// Load config from disk, falling back to (and persisting) defaults.
pub fn load() -> AppConfig {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<AppConfig>(&s).unwrap_or_default(),
        Err(_) => {
            let cfg = AppConfig::default();
            let _ = save(&cfg);
            cfg
        }
    }
}

/// Persist config to disk (creating the parent directory as needed).
pub fn save(cfg: &AppConfig) -> std::io::Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(cfg).unwrap_or_else(|_| "{}".to_string());
    std::fs::write(&path, json)
}

/// Best-effort auto-detection of a `llama-server` binary on this machine so the
/// app is usable on first run without manual configuration.
pub fn detect_llama_binary() -> Option<PathBuf> {
    // 1) PATH lookup.
    let exe = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    if let Ok(path_var) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in path_var.split(sep) {
            let candidate = PathBuf::from(dir).join(exe);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 2) Common install locations (winget / homebrew / manual).
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(&local)
                    .join("Microsoft")
                    .join("WinGet")
                    .join("Packages")
                    .join("ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe")
                    .join("llama-server.exe"),
            );
        }
    } else {
        candidates.push(PathBuf::from("/opt/homebrew/bin/llama-server"));
        candidates.push(PathBuf::from("/usr/local/bin/llama-server"));
        candidates.push(PathBuf::from("/usr/bin/llama-server"));
    }
    candidates.into_iter().find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg_with_models_dir(dir: &str) -> AppConfig {
        AppConfig {
            models_dir: dir.to_string(),
            ..AppConfig::default()
        }
    }

    #[test]
    fn resolve_model_joins_a_bare_filename() {
        let c = cfg_with_models_dir("/models");
        let p = c.resolve_model("qwen.gguf");
        assert_eq!(p, PathBuf::from("/models").join("qwen.gguf"));
    }

    #[test]
    fn resolve_model_keeps_nested_relative_segments_but_stays_inside() {
        let c = cfg_with_models_dir("/models");
        let p = c.resolve_model("sub/qwen.gguf");
        assert_eq!(p, PathBuf::from("/models").join("sub").join("qwen.gguf"));
    }

    #[test]
    fn resolve_model_strips_parent_traversal() {
        let c = cfg_with_models_dir("/models");
        // `..` components must be dropped, never escaping models_dir.
        let p = c.resolve_model("../../etc/passwd");
        assert_eq!(
            p,
            PathBuf::from("/models").join("etc").join("passwd"),
            "traversal components must be stripped"
        );
        assert!(!p.to_string_lossy().contains(".."));
        assert!(p.starts_with("/models"));
    }

    #[test]
    fn resolve_model_strips_leading_dot_segments() {
        let c = cfg_with_models_dir("/models");
        let p = c.resolve_model("./nested/../model.gguf");
        // `.` dropped, `..` dropped → just the Normal segments remain.
        assert_eq!(
            p,
            PathBuf::from("/models").join("nested").join("model.gguf")
        );
        assert!(p.starts_with("/models"));
    }

    #[cfg(unix)]
    #[test]
    fn resolve_model_honours_absolute_paths() {
        let c = cfg_with_models_dir("/models");
        let p = c.resolve_model("/opt/models/custom.gguf");
        assert_eq!(p, PathBuf::from("/opt/models/custom.gguf"));
    }
}

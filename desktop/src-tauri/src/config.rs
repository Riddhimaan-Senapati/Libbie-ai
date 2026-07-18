//! Persistent, on-disk configuration for the Libbie desktop client.
//!
//! Everything here is local: paths to the inference engine binaries, the model
//! cache directory, the chat/embedding model selections, and the air-gapped
//! (offline) switch. No secrets, no remote endpoints — by design, the only
//! network destinations this app ever talks to are `127.0.0.1` engine ports.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Which inference engine the client should prefer.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PreferredEngine {
    /// Detect hardware and pick vLLM (Linux+NVIDIA) or llama.cpp otherwise.
    Auto,
    /// Force llama.cpp `llama-server` (GGUF).
    Llama,
    /// Force vLLM (Linux + NVIDIA CUDA only).
    Vllm,
}

impl Default for PreferredEngine {
    fn default() -> Self {
        PreferredEngine::Auto
    }
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
    pub fn resolve_model(&self, sel: &str) -> PathBuf {
        let p = PathBuf::from(sel);
        if p.is_absolute() {
            p
        } else {
            PathBuf::from(&self.models_dir).join(sel)
        }
    }

    /// Enforce the air-gap invariants on a config coming from the (untrusted)
    /// webview before it is persisted or used to spawn a process. Rejects a
    /// non-loopback host (which would let the UI redirect all inference traffic
    /// off-box) and any engine-binary path that is not a recognised local engine
    /// (which would otherwise let the UI make Rust spawn an arbitrary executable).
    pub fn validate(&self) -> Result<(), String> {
        if !is_loopback_host(&self.host) {
            return Err(format!(
                "host must be loopback (127.0.0.1 / ::1 / localhost); refused {:?}",
                self.host
            ));
        }
        validate_engine_binary("llama_binary", self.llama_binary.as_deref())?;
        validate_engine_binary("vllm_binary", self.vllm_binary.as_deref())?;
        Ok(())
    }
}

/// True only for genuine loopback destinations. Parses the host as an IP (so the
/// full 127.0.0.0/8 range and ::1 are covered) or accepts the literal
/// "localhost" — deliberately NOT a substring test, so `127.0.0.1.evil.com`,
/// `localhost.evil.com`, and `evil.com/?x=127.0.0.1` are all rejected.
pub fn is_loopback_host(host: &str) -> bool {
    let h = host.trim();
    // Strip brackets from IPv6 literals like `[::1]`.
    let h = h
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(h);
    if h.eq_ignore_ascii_case("localhost") {
        return true;
    }
    matches!(h.parse::<std::net::IpAddr>(), Ok(ip) if ip.is_loopback())
}

/// Engine-binary paths are privileged: the app spawns them. Only allow an
/// absolute path to an existing file whose name is a recognised engine launcher.
fn validate_engine_binary(label: &str, path: Option<&str>) -> Result<(), String> {
    let Some(path) = path else { return Ok(()) };
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err(format!("{label} must be an absolute path: {path:?}"));
    }
    if !p.is_file() {
        return Err(format!("{label} is not an existing file: {path:?}"));
    }
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let base = name.strip_suffix(".exe").unwrap_or(&name);
    const ALLOWED: [&str; 4] = ["llama-server", "vllm", "python", "python3"];
    if !ALLOWED.contains(&base) {
        return Err(format!(
            "{label} must be a recognised engine launcher \
             (llama-server / vllm / python); refused {name:?}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_loopback_host;

    #[test]
    fn loopback_hosts_accepted() {
        for h in ["127.0.0.1", "localhost", "LOCALHOST", "::1", "[::1]", "127.5.5.5"] {
            assert!(is_loopback_host(h), "{h} should be loopback");
        }
    }

    #[test]
    fn spoofed_hosts_rejected() {
        for h in [
            "127.0.0.1.evil.com",
            "localhost.evil.com",
            "evil.com",
            "10.0.0.5",
            "8.8.8.8",
            "0.0.0.0",
            "",
        ] {
            assert!(!is_loopback_host(h), "{h} must NOT be loopback");
        }
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

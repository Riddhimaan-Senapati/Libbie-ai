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

/// Where chat completions come from.
///
/// - `Local`: a llama.cpp / vLLM server this app manages on loopback.
/// - `OpenaiCompatible`: any OpenAI-compatible endpoint (OpenAI, Groq, Together, Mistral, OpenRouter, a self-hosted vLLM) via base URL + key.
/// - `Anthropic`: the Anthropic Messages API natively.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ChatProvider {
    #[default]
    Local,
    OpenaiCompatible,
    Anthropic,
}

/// A resolved chat/embedding destination: everything a request needs, with no
/// knowledge of which provider the user picked.
#[derive(Debug, Clone)]
pub struct ProviderTarget {
    pub anthropic: bool,  // true => Anthropic wire format; false => OpenAI-compatible
    pub base_url: String, // no trailing slash
    pub api_key: Option<String>,
    pub model: String,
    pub is_local: bool, // true => loopback-enforced (air-gap)
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

    // ---- cloud providers (used only when offline_mode is off) --------------
    /// Which chat backend to use. `Local` keeps the strict air-gap.
    pub chat_provider: ChatProvider,
    /// OpenAI-compatible endpoint (OpenAI, Groq, Together, Mistral, OpenRouter, …).
    pub openai_base_url: String,
    pub openai_api_key: Option<String>,
    pub openai_model: String,
    /// Embedding model for the OpenAI-compatible endpoint (for cloud RAG).
    pub openai_embed_model: String,
    /// Anthropic Messages API.
    pub anthropic_base_url: String,
    pub anthropic_api_key: Option<String>,
    pub anthropic_model: String,

    // ---- GitHub integration (OAuth device flow) ---------------------------
    /// OAuth access token from the device flow. Sensitive — never logged.
    /// Stored alongside the API-key fields for consistency.
    pub github_token: Option<String>,
    /// Registered GitHub OAuth App client id. Empty falls back to the
    /// `LIBBIE_GITHUB_CLIENT_ID` environment variable. Device flow needs no secret.
    pub github_client_id: String,

    // ---- Slack connector --------------------------------------------------
    /// Slack user token (`xoxp-…`), from token-paste or the OAuth v2 flow.
    /// Sensitive — never logged, redacted from the webview.
    pub slack_token: Option<String>,
    /// Slack app client id (OAuth v2). Empty falls back to `LIBBIE_SLACK_CLIENT_ID`.
    pub slack_client_id: String,
    /// Slack app client secret (OAuth v2 only). Sensitive. Empty falls back to
    /// `LIBBIE_SLACK_CLIENT_SECRET`.
    pub slack_client_secret: Option<String>,

    // ---- Email: Gmail (OAuth) --------------------------------------------
    /// Gmail OAuth access token. Sensitive — never logged, redacted.
    pub gmail_token: Option<String>,
    /// Gmail OAuth client id. Empty falls back to `LIBBIE_GMAIL_CLIENT_ID`.
    pub gmail_client_id: String,
    /// Gmail OAuth client secret (installed-app; not truly secret but still
    /// redacted). Empty falls back to `LIBBIE_GMAIL_CLIENT_SECRET`.
    pub gmail_client_secret: Option<String>,

    // ---- Email: IMAP (app password) --------------------------------------
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_user: String,
    /// IMAP app password. Sensitive — never logged, redacted.
    pub imap_password: Option<String>,
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
            chat_provider: ChatProvider::Local,
            openai_base_url: "https://api.openai.com/v1".to_string(),
            openai_api_key: None,
            openai_model: "gpt-4o-mini".to_string(),
            openai_embed_model: "text-embedding-3-small".to_string(),
            anthropic_base_url: "https://api.anthropic.com".to_string(),
            anthropic_api_key: None,
            anthropic_model: "claude-sonnet-5".to_string(),
            github_token: None,
            github_client_id: String::new(),
            slack_token: None,
            slack_client_id: String::new(),
            slack_client_secret: None,
            gmail_token: None,
            gmail_client_id: String::new(),
            gmail_client_secret: None,
            imap_host: String::new(),
            imap_port: 993,
            imap_user: String::new(),
            imap_password: None,
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

    /// An OpenAI-compatible cloud target (base URL + key), for a given model.
    fn openai_target(&self, model: String) -> ProviderTarget {
        ProviderTarget {
            anthropic: false,
            base_url: self.openai_base_url.trim_end_matches('/').to_string(),
            api_key: self.openai_api_key.clone(),
            model,
            is_local: false,
        }
    }

    /// Resolve the active chat destination from the selected provider.
    pub fn chat_target(&self) -> ProviderTarget {
        match self.chat_provider {
            // OpenAI-compatible base URLs include the /v1 prefix; local engines
            // serve it too, so append it for a uniform endpoint path.
            ChatProvider::Local => local_target(format!("{}/v1", self.chat_base_url())),
            ChatProvider::OpenaiCompatible => self.openai_target(self.openai_model.clone()),
            ChatProvider::Anthropic => ProviderTarget {
                anthropic: true,
                base_url: self.anthropic_base_url.trim_end_matches('/').to_string(),
                api_key: self.anthropic_api_key.clone(),
                model: self.anthropic_model.clone(),
                is_local: false,
            },
        }
    }

    /// Resolve the embedding destination. Anthropic has no embeddings API, so
    /// only an OpenAI-compatible cloud provider serves cloud embeddings; Local
    /// and Anthropic both fall back to the local embedding engine.
    pub fn embed_target(&self) -> ProviderTarget {
        if self.chat_provider == ChatProvider::OpenaiCompatible {
            self.openai_target(self.openai_embed_model.clone())
        } else {
            local_target(format!("{}/v1", self.embed_base_url()))
        }
    }

    /// Enforce the air-gap invariants on a config coming from the (untrusted)
    /// webview before it is persisted or used to spawn a process. Rejects a
    /// non-loopback host (which would let the UI redirect local traffic off-box),
    /// any engine-binary path that is not a recognised local engine (arbitrary
    /// exec), and any cloud provider while strict air-gap is on.
    pub fn validate(&self) -> Result<(), String> {
        if !is_loopback_host(&self.host) {
            return Err(format!(
                "host must be loopback (127.0.0.1 / ::1 / localhost); refused {:?}",
                self.host
            ));
        }
        validate_engine_binary("llama_binary", self.llama_binary.as_deref())?;
        validate_engine_binary("vllm_binary", self.vllm_binary.as_deref())?;

        // Strict air-gap is incompatible with any off-box provider.
        if self.offline_mode && self.chat_provider != ChatProvider::Local {
            return Err("Strict air-gapped mode allows only the Local provider. \
                        Turn off air-gap to use a cloud API, or select Local."
                .to_string());
        }
        match self.chat_provider {
            ChatProvider::OpenaiCompatible => {
                require_http_url("openai_base_url", &self.openai_base_url)?
            }
            ChatProvider::Anthropic => {
                require_http_url("anthropic_base_url", &self.anthropic_base_url)?
            }
            ChatProvider::Local => {}
        }
        Ok(())
    }

    /// A copy safe to hand to the (untrusted) webview: every secret is masked to
    /// SECRET_SENTINEL when set, or None when unset. The real values never leave
    /// the Rust core (inference/github proxy through Rust). See get_config.
    pub fn redacted(&self) -> AppConfig {
        let mut c = self.clone();
        c.openai_api_key = mask_secret(&c.openai_api_key);
        c.anthropic_api_key = mask_secret(&c.anthropic_api_key);
        c.github_token = mask_secret(&c.github_token);
        c.slack_token = mask_secret(&c.slack_token);
        c.slack_client_secret = mask_secret(&c.slack_client_secret);
        c.gmail_token = mask_secret(&c.gmail_token);
        c.gmail_client_secret = mask_secret(&c.gmail_client_secret);
        c.imap_password = mask_secret(&c.imap_password);
        c
    }

    /// Merge secrets from the currently-stored config into an incoming config
    /// from the webview: a field equal to SECRET_SENTINEL means "unchanged" and
    /// keeps the stored value; an empty string clears it; anything else updates.
    pub fn merge_secrets_from(&mut self, current: &AppConfig) {
        self.openai_api_key = merge_secret(self.openai_api_key.take(), &current.openai_api_key);
        self.anthropic_api_key =
            merge_secret(self.anthropic_api_key.take(), &current.anthropic_api_key);
        self.github_token = merge_secret(self.github_token.take(), &current.github_token);
        self.slack_token = merge_secret(self.slack_token.take(), &current.slack_token);
        self.slack_client_secret = merge_secret(
            self.slack_client_secret.take(),
            &current.slack_client_secret,
        );
        self.gmail_token = merge_secret(self.gmail_token.take(), &current.gmail_token);
        self.gmail_client_secret = merge_secret(
            self.gmail_client_secret.take(),
            &current.gmail_client_secret,
        );
        self.imap_password = merge_secret(self.imap_password.take(), &current.imap_password);
    }
}

/// Sentinel the UI shows in place of a stored secret; sent back verbatim means
/// "keep the existing value".
pub const SECRET_SENTINEL: &str = "__libbie_saved__";

fn mask_secret(v: &Option<String>) -> Option<String> {
    match v {
        Some(s) if !s.is_empty() => Some(SECRET_SENTINEL.to_string()),
        _ => None,
    }
}

fn merge_secret(incoming: Option<String>, current: &Option<String>) -> Option<String> {
    match incoming {
        Some(s) if s == SECRET_SENTINEL => current.clone(), // unchanged -> keep stored
        Some(s) if s.is_empty() => None,                    // explicitly cleared
        other => other,                                     // updated
    }
}

/// A loopback-enforced local target (no key, OpenAI wire) at `base_url`.
fn local_target(base_url: String) -> ProviderTarget {
    ProviderTarget {
        anthropic: false,
        base_url,
        api_key: None,
        model: "local".to_string(),
        is_local: true,
    }
}

/// A minimal http(s) URL check for cloud endpoints (no dependency needed).
fn require_http_url(label: &str, url: &str) -> Result<(), String> {
    let u = url.trim();
    let rest = u
        .strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"));
    match rest {
        Some(host) if !host.is_empty() => Ok(()),
        _ => Err(format!("{label} must be an http(s) URL; refused {url:?}")),
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
    use super::*;

    #[test]
    fn loopback_hosts_accepted() {
        for h in [
            "127.0.0.1",
            "localhost",
            "LOCALHOST",
            "::1",
            "[::1]",
            "127.5.5.5",
        ] {
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

    #[test]
    fn local_default_config_validates() {
        assert!(AppConfig::default().validate().is_ok());
    }

    #[test]
    fn air_gap_forbids_cloud_providers() {
        let mut c = AppConfig {
            offline_mode: true,
            chat_provider: ChatProvider::OpenaiCompatible,
            openai_api_key: Some("sk-x".into()),
            ..Default::default()
        };
        assert!(c.validate().is_err(), "air-gap + cloud must be rejected");
        c.offline_mode = false;
        assert!(c.validate().is_ok(), "cloud allowed once air-gap is off");
    }

    #[test]
    fn cloud_requires_http_url() {
        let mut c = AppConfig {
            offline_mode: false,
            chat_provider: ChatProvider::OpenaiCompatible,
            openai_base_url: "ftp://nope".into(),
            ..Default::default()
        };
        assert!(c.validate().is_err());
        c.openai_base_url = "https://api.groq.com/openai/v1".into();
        assert!(c.validate().is_ok());
    }

    #[test]
    fn targets_route_by_provider() {
        let mut c = AppConfig::default();
        // Local -> loopback, no key, OpenAI wire.
        let t = c.chat_target();
        assert!(t.is_local && !t.anthropic && t.base_url.contains("127.0.0.1"));
        // Anthropic -> native wire, its base URL + model.
        c.chat_provider = ChatProvider::Anthropic;
        c.anthropic_api_key = Some("sk-ant".into());
        let t = c.chat_target();
        assert!(t.anthropic && !t.is_local && t.base_url.contains("api.anthropic.com"));
        assert_eq!(t.model, "claude-sonnet-5");
        // OpenAI-compatible embeddings route to the cloud endpoint.
        c.chat_provider = ChatProvider::OpenaiCompatible;
        assert!(!c.embed_target().is_local);
    }

    #[test]
    fn redaction_hides_secrets_and_merge_preserves_them() {
        let c = AppConfig {
            openai_api_key: Some("sk-real".into()),
            github_token: Some("gho-real".into()),
            ..Default::default()
        };

        // redacted(): set secrets masked to the sentinel, unset ones dropped.
        let red = c.redacted();
        assert_eq!(red.openai_api_key.as_deref(), Some(SECRET_SENTINEL));
        assert_eq!(red.github_token.as_deref(), Some(SECRET_SENTINEL));
        assert_eq!(red.anthropic_api_key, None);

        // merge_secrets_from(): sentinel keeps stored, empty clears, other updates.
        let mut incoming = red.clone();
        incoming.anthropic_api_key = Some("sk-new".into());
        incoming.github_token = Some(String::new());
        incoming.merge_secrets_from(&c);
        assert_eq!(incoming.openai_api_key.as_deref(), Some("sk-real"));
        assert_eq!(incoming.anthropic_api_key.as_deref(), Some("sk-new"));
        assert_eq!(incoming.github_token, None);
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

/// Scratch directory for GitHub repo clones: `<data-dir>/Libbie/repos`. Clones
/// are shallow and removed after indexing.
pub fn github_repos_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("Libbie").join("repos")
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
mod resolve_model_tests {
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

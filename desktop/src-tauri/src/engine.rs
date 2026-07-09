//! Local inference-engine lifecycle: hardware detection, engine selection,
//! process spawn / health-check / shutdown.
//!
//! Two engines share one OpenAI-compatible contract:
//!   * **vLLM** — Linux + NVIDIA CUDA (primary, when available).
//!   * **llama.cpp `llama-server`** — macOS / Windows / CPU / non-NVIDIA (fallback),
//!     selecting Metal / CUDA / Vulkan / CPU per platform.
//!
//! The client is engine-agnostic: it always talks to `/v1/chat/completions` and
//! `/v1/embeddings` on a loopback port. This module owns the child process.

use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::config::{AppConfig, PreferredEngine};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EngineKind {
    Llama,
    Vllm,
}

/// A snapshot of the host's inference-relevant hardware.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub os: String,
    pub arch: String,
    pub cpu_count: usize,
    pub total_mem_mb: u64,
    pub has_nvidia: bool,
    pub gpu_names: Vec<String>,
    /// Human-readable acceleration backend llama.cpp will most likely use.
    pub llama_backend: String,
}

/// The engine-selection decision plus the reasoning shown in the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineChoice {
    pub engine: EngineKind,
    pub reason: String,
}

/// Live status of the managed engine, surfaced to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStatus {
    pub running: bool,
    pub healthy: bool,
    pub engine: Option<EngineKind>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub pid: Option<u32>,
    pub message: String,
}

impl Default for EngineStatus {
    fn default() -> Self {
        EngineStatus {
            running: false,
            healthy: false,
            engine: None,
            model: None,
            base_url: None,
            pid: None,
            message: "Engine stopped".to_string(),
        }
    }
}

/// Detect host hardware to drive engine selection and the degraded-mode UX.
pub fn detect_hardware() -> HardwareInfo {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_memory();

    let cpu_count = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    let total_mem_mb = sys.total_memory() / 1024 / 1024;

    let (has_nvidia, gpu_names) = detect_nvidia();

    let arch = std::env::consts::ARCH.to_string();
    let os = std::env::consts::OS.to_string();

    // Which llama.cpp backend is most likely selected on this platform.
    let llama_backend = if has_nvidia {
        "CUDA".to_string()
    } else if os == "macos" {
        "Metal".to_string()
    } else if !gpu_names.is_empty() {
        "Vulkan".to_string()
    } else {
        "CPU".to_string()
    };

    HardwareInfo {
        os,
        arch,
        cpu_count,
        total_mem_mb,
        has_nvidia,
        gpu_names,
        llama_backend,
    }
}

/// Probe for an NVIDIA GPU via `nvidia-smi` (works cross-platform when the
/// driver is installed). Returns (has_nvidia, gpu names).
fn detect_nvidia() -> (bool, Vec<String>) {
    let out = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=name", "--format=csv,noheader"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    match out {
        Ok(o) if o.status.success() => {
            let names: Vec<String> = String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            (!names.is_empty(), names)
        }
        _ => (false, Vec::new()),
    }
}

/// Decide which engine to run given hardware + config preference.
///
/// Rule (LOCKED per build spec):
///   * `Vllm` only on Linux + NVIDIA; otherwise it is not achievable.
///   * `Auto` → vLLM when Linux+NVIDIA+configured, else llama.cpp.
pub fn choose_engine(hw: &HardwareInfo, cfg: &AppConfig) -> EngineChoice {
    let vllm_possible = hw.os == "linux" && hw.has_nvidia && cfg.vllm_binary.is_some();

    match cfg.preferred_engine {
        PreferredEngine::Vllm => {
            if vllm_possible {
                EngineChoice {
                    engine: EngineKind::Vllm,
                    reason: "vLLM forced (Linux + NVIDIA CUDA detected).".to_string(),
                }
            } else {
                EngineChoice {
                    engine: EngineKind::Llama,
                    reason: "vLLM requested but requires Linux + NVIDIA + a configured vLLM binary; falling back to llama.cpp.".to_string(),
                }
            }
        }
        PreferredEngine::Llama => EngineChoice {
            engine: EngineKind::Llama,
            reason: format!("llama.cpp forced ({} backend).", hw.llama_backend),
        },
        PreferredEngine::Auto => {
            if vllm_possible {
                EngineChoice {
                    engine: EngineKind::Vllm,
                    reason: "Auto: Linux + NVIDIA CUDA present → vLLM.".to_string(),
                }
            } else {
                EngineChoice {
                    engine: EngineKind::Llama,
                    reason: format!(
                        "Auto: no Linux+NVIDIA vLLM host → llama.cpp ({} backend).",
                        hw.llama_backend
                    ),
                }
            }
        }
    }
}

/// Build the `vllm serve …` argument vector. Pure so it can be unit-tested
/// against the documented vLLM CLI without launching anything.
fn vllm_command_args(cfg: &AppConfig, model: &str) -> Vec<String> {
    let mut args = vec![
        "serve".to_string(),
        model.to_string(),
        "--host".to_string(),
        cfg.host.clone(),
        "--port".to_string(),
        cfg.chat_port.to_string(),
        "--served-model-name".to_string(),
        "local".to_string(),
        "--gpu-memory-utilization".to_string(),
        format!("{}", cfg.vllm_gpu_mem_util),
        "--dtype".to_string(),
        cfg.vllm_dtype.clone(),
    ];
    if let Some(n) = cfg.vllm_max_model_len {
        args.push("--max-model-len".to_string());
        args.push(n.to_string());
    }
    if let Some(q) = &cfg.vllm_quantization {
        if !q.is_empty() {
            args.push("--quantization".to_string());
            args.push(q.clone());
        }
    }
    args
}

/// Owns the running engine child processes (chat + embeddings) and their status.
pub struct EngineManager {
    child: Mutex<Option<Child>>,
    status: Mutex<EngineStatus>,
    embed_child: Mutex<Option<Child>>,
    embed_status: Mutex<EngineStatus>,
    client: reqwest::Client,
}

impl EngineManager {
    pub fn new() -> Arc<Self> {
        Arc::new(EngineManager {
            child: Mutex::new(None),
            status: Mutex::new(EngineStatus::default()),
            embed_child: Mutex::new(None),
            embed_status: Mutex::new(EngineStatus::default()),
            client: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(600))
                .build()
                .expect("failed to build reqwest client"),
        })
    }

    pub fn client(&self) -> reqwest::Client {
        self.client.clone()
    }

    pub async fn status(&self) -> EngineStatus {
        self.status.lock().await.clone()
    }

    async fn set_status(&self, s: EngineStatus) {
        *self.status.lock().await = s;
    }

    /// Start the chat engine per config: detect hardware, pick the engine, and
    /// dispatch to the engine-specific launcher. Both speak the same
    /// OpenAI-compatible API on `chat_port`, so the client is unchanged.
    pub async fn start(&self, cfg: &AppConfig) -> Result<EngineStatus, String> {
        // If something is already running, stop it first (hot model-swap).
        self.stop().await;

        let hw = detect_hardware();
        let choice = choose_engine(&hw, cfg);

        match choice.engine {
            EngineKind::Vllm => self.start_vllm(cfg, &choice).await,
            EngineKind::Llama => self.start_llama(cfg, &hw, &choice).await,
        }
    }

    /// Launch llama.cpp `llama-server` (GGUF) on `chat_port`.
    async fn start_llama(
        &self,
        cfg: &AppConfig,
        hw: &HardwareInfo,
        choice: &EngineChoice,
    ) -> Result<EngineStatus, String> {
        let binary = cfg
            .llama_binary
            .clone()
            .ok_or_else(|| "No llama-server binary configured. Set it in Settings.".to_string())?;

        let model = cfg
            .chat_model
            .clone()
            .ok_or_else(|| "No chat model selected. Choose a GGUF model in Settings.".to_string())?;
        let model_path = cfg.resolve_model(&model);
        if !model_path.is_file() {
            return Err(format!(
                "Model file not found: {}",
                model_path.to_string_lossy()
            ));
        }

        let base_url = cfg.chat_base_url();
        let mut cmd = Command::new(&binary);
        cmd.arg("-m")
            .arg(&model_path)
            .arg("--host")
            .arg(&cfg.host)
            .arg("--port")
            .arg(cfg.chat_port.to_string())
            .arg("-c")
            .arg(cfg.ctx_size.to_string())
            .arg("-ngl")
            .arg(cfg.gpu_layers.to_string())
            .arg("--no-webui")
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        // Do not pop a console window on Windows. `creation_flags` is an
        // inherent method on tokio's Command on Windows.
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to launch engine '{}': {}", binary, e))?;
        let pid = child.id();
        *self.child.lock().await = Some(child);

        self.set_status(EngineStatus {
            running: true,
            healthy: false,
            engine: Some(EngineKind::Llama),
            model: Some(model.clone()),
            base_url: Some(base_url.clone()),
            pid,
            message: "Loading model…".to_string(),
        })
        .await;

        let healthy = self.wait_healthy(&base_url, Duration::from_secs(180)).await;
        let final_status = EngineStatus {
            running: true,
            healthy,
            engine: Some(EngineKind::Llama),
            model: Some(model),
            base_url: Some(base_url),
            pid,
            message: if healthy {
                format!("Ready · {} · {}", choice.engine_label(), hw.llama_backend)
            } else {
                "Engine started but did not become healthy in time.".to_string()
            },
        };
        self.set_status(final_status.clone()).await;

        if healthy {
            Ok(final_status)
        } else {
            Err(final_status.message)
        }
    }

    /// Launch the vLLM OpenAI-compatible server (`vllm serve …`) on `chat_port`.
    /// Only reached on Linux + NVIDIA (see `choose_engine`). Same API contract as
    /// llama.cpp, so the RAG/inference client needs no changes.
    async fn start_vllm(
        &self,
        cfg: &AppConfig,
        choice: &EngineChoice,
    ) -> Result<EngineStatus, String> {
        let binary = cfg
            .vllm_binary
            .clone()
            .unwrap_or_else(|| "vllm".to_string());
        let model = cfg.vllm_model.clone().ok_or_else(|| {
            "No vLLM model set. Enter a HuggingFace repo id or local model path in Settings."
                .to_string()
        })?;
        let base_url = cfg.chat_base_url();

        let mut cmd = Command::new(&binary);
        cmd.args(vllm_command_args(cfg, &model));
        cmd.stdout(Stdio::null()).stderr(Stdio::null());

        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to launch vLLM '{}': {}. vLLM requires Linux + NVIDIA CUDA and an \
                 installed `vllm` (pip install vllm).",
                binary, e
            )
        })?;
        let pid = child.id();
        *self.child.lock().await = Some(child);

        self.set_status(EngineStatus {
            running: true,
            healthy: false,
            engine: Some(EngineKind::Vllm),
            model: Some(model.clone()),
            base_url: Some(base_url.clone()),
            pid,
            message: "Loading model (vLLM)…".to_string(),
        })
        .await;

        // vLLM can take a while to download/compile/load large models.
        let healthy = self.wait_healthy(&base_url, Duration::from_secs(900)).await;
        let final_status = EngineStatus {
            running: true,
            healthy,
            engine: Some(EngineKind::Vllm),
            model: Some(model),
            base_url: Some(base_url),
            pid,
            message: if healthy {
                format!("Ready · {}", choice.engine_label())
            } else {
                "vLLM started but did not become healthy in time.".to_string()
            },
        };
        self.set_status(final_status.clone()).await;

        if healthy {
            Ok(final_status)
        } else {
            Err(final_status.message)
        }
    }

    /// Poll `GET {base}/health` until ready or the deadline passes. Both engines
    /// return a non-2xx (or refuse the connection) while loading and a 2xx once
    /// ready — llama.cpp with `{"status":"ok"}`, vLLM with an empty body.
    async fn wait_healthy(&self, base_url: &str, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        let url = format!("{}/health", base_url);
        loop {
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            if let Ok(resp) = self.client.get(&url).send().await {
                if resp.status().is_success() {
                    return true;
                }
            }
            tokio::time::sleep(Duration::from_millis(700)).await;
        }
    }

    /// Stop the managed chat engine (best-effort kill + reap).
    pub async fn stop(&self) {
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        drop(guard);
        self.set_status(EngineStatus::default()).await;
    }

    // ---- embedding engine (second llama-server on embed_port) --------------

    pub async fn embed_status(&self) -> EngineStatus {
        self.embed_status.lock().await.clone()
    }

    async fn set_embed_status(&self, s: EngineStatus) {
        *self.embed_status.lock().await = s;
    }

    /// Start the embeddings engine: a second `llama-server` in `--embedding`
    /// mode serving the GGUF embedding model on `embed_port`.
    pub async fn start_embed(&self, cfg: &AppConfig) -> Result<EngineStatus, String> {
        self.stop_embed().await;

        let binary = cfg
            .llama_binary
            .clone()
            .ok_or_else(|| "No llama-server binary configured. Set it in Settings.".to_string())?;
        let model = cfg.embed_model.clone().ok_or_else(|| {
            "No embedding model selected. Choose a GGUF embedding model in Settings.".to_string()
        })?;
        let model_path = cfg.resolve_model(&model);
        if !model_path.is_file() {
            return Err(format!(
                "Embedding model not found: {}",
                model_path.to_string_lossy()
            ));
        }

        let base_url = cfg.embed_base_url();
        let mut cmd = Command::new(&binary);
        cmd.arg("-m")
            .arg(&model_path)
            .arg("--host")
            .arg(&cfg.host)
            .arg("--port")
            .arg(cfg.embed_port.to_string())
            .arg("--embedding")
            .arg("--pooling")
            .arg("mean")
            .arg("-c")
            .arg("2048")
            .arg("-ngl")
            .arg(cfg.gpu_layers.to_string())
            .arg("--no-webui")
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to launch embedding engine '{}': {}", binary, e))?;
        let pid = child.id();
        *self.embed_child.lock().await = Some(child);

        self.set_embed_status(EngineStatus {
            running: true,
            healthy: false,
            engine: Some(EngineKind::Llama),
            model: Some(model.clone()),
            base_url: Some(base_url.clone()),
            pid,
            message: "Loading embedding model…".to_string(),
        })
        .await;

        let healthy = self.wait_healthy(&base_url, Duration::from_secs(180)).await;
        let final_status = EngineStatus {
            running: true,
            healthy,
            engine: Some(EngineKind::Llama),
            model: Some(model),
            base_url: Some(base_url),
            pid,
            message: if healthy {
                "Embeddings ready".to_string()
            } else {
                "Embedding engine started but did not become healthy in time.".to_string()
            },
        };
        self.set_embed_status(final_status.clone()).await;

        if healthy {
            Ok(final_status)
        } else {
            Err(final_status.message)
        }
    }

    pub async fn stop_embed(&self) {
        let mut guard = self.embed_child.lock().await;
        if let Some(mut child) = guard.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        drop(guard);
        self.set_embed_status(EngineStatus::default()).await;
    }

    /// Stop both engines (used on app exit).
    pub async fn stop_all(&self) {
        self.stop().await;
        self.stop_embed().await;
    }
}

impl EngineChoice {
    fn engine_label(&self) -> &'static str {
        match self.engine {
            EngineKind::Llama => "llama.cpp",
            EngineKind::Vllm => "vLLM",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::PreferredEngine;

    fn cfg() -> AppConfig {
        let mut c = AppConfig::default();
        c.vllm_binary = Some("vllm".to_string());
        c.vllm_model = Some("Qwen/Qwen2.5-7B-Instruct".to_string());
        c
    }

    fn hw(os: &str, nvidia: bool) -> HardwareInfo {
        HardwareInfo {
            os: os.to_string(),
            arch: "x86_64".to_string(),
            cpu_count: 8,
            total_mem_mb: 16_000,
            has_nvidia: nvidia,
            gpu_names: if nvidia {
                vec!["NVIDIA A10".to_string()]
            } else {
                vec![]
            },
            llama_backend: if nvidia { "CUDA".into() } else { "CPU".into() },
        }
    }

    // ---- engine selection (the LOCKED rule) -------------------------------

    #[test]
    fn auto_selects_vllm_only_on_linux_nvidia_with_binary() {
        let mut c = cfg();
        c.preferred_engine = PreferredEngine::Auto;
        assert_eq!(choose_engine(&hw("linux", true), &c).engine, EngineKind::Vllm);
    }

    #[test]
    fn auto_falls_back_to_llama_off_linux_or_without_nvidia() {
        let mut c = cfg();
        c.preferred_engine = PreferredEngine::Auto;
        // No NVIDIA → llama, even on Linux.
        assert_eq!(choose_engine(&hw("linux", false), &c).engine, EngineKind::Llama);
        // NVIDIA but not Linux (Windows/macOS) → llama.
        assert_eq!(choose_engine(&hw("windows", true), &c).engine, EngineKind::Llama);
        assert_eq!(choose_engine(&hw("macos", true), &c).engine, EngineKind::Llama);
    }

    #[test]
    fn auto_needs_a_vllm_binary_configured() {
        let mut c = cfg();
        c.preferred_engine = PreferredEngine::Auto;
        c.vllm_binary = None;
        assert_eq!(choose_engine(&hw("linux", true), &c).engine, EngineKind::Llama);
    }

    #[test]
    fn forcing_vllm_without_support_falls_back_to_llama() {
        let mut c = cfg();
        c.preferred_engine = PreferredEngine::Vllm;
        // Forced, but no NVIDIA → still llama (graceful).
        assert_eq!(choose_engine(&hw("linux", false), &c).engine, EngineKind::Llama);
    }

    #[test]
    fn forcing_llama_is_always_llama() {
        let mut c = cfg();
        c.preferred_engine = PreferredEngine::Llama;
        assert_eq!(choose_engine(&hw("linux", true), &c).engine, EngineKind::Llama);
    }

    // ---- vLLM command construction matches the documented CLI --------------

    fn pair(a: &[String], k: &str, v: &str) -> bool {
        a.windows(2).any(|w| w[0] == k && w[1] == v)
    }

    #[test]
    fn vllm_args_match_documented_cli() {
        let mut c = cfg();
        c.host = "127.0.0.1".into();
        c.chat_port = 51820;
        c.vllm_gpu_mem_util = 0.9;
        c.vllm_dtype = "auto".into();
        c.vllm_max_model_len = Some(8192);
        c.vllm_quantization = Some("awq".into());
        let a = vllm_command_args(&c, "Qwen/Qwen2.5-7B-Instruct");

        assert_eq!(a[0], "serve");
        assert_eq!(a[1], "Qwen/Qwen2.5-7B-Instruct");
        assert!(pair(&a, "--host", "127.0.0.1"));
        assert!(pair(&a, "--port", "51820"));
        assert!(pair(&a, "--served-model-name", "local"));
        assert!(pair(&a, "--gpu-memory-utilization", "0.9"));
        assert!(pair(&a, "--dtype", "auto"));
        assert!(pair(&a, "--max-model-len", "8192"));
        assert!(pair(&a, "--quantization", "awq"));
    }

    #[test]
    fn vllm_args_omit_optional_flags_when_unset() {
        let mut c = cfg();
        c.vllm_max_model_len = None;
        c.vllm_quantization = None;
        let a = vllm_command_args(&c, "m");
        assert!(!a.iter().any(|x| x == "--max-model-len"));
        assert!(!a.iter().any(|x| x == "--quantization"));
    }
}

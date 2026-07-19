//! Structured error type shared across the whole Rust core and the IPC boundary.
//!
//! Every Tauri command returns `Result<T, AppError>`. `AppError` serialises as a
//! serde-tagged object — `{ "kind": "modelNotFound", "message": "…" }` — so the
//! TypeScript client can branch on `kind` for programmatic recovery (e.g. "port
//! in use" vs "model not found") while still having a ready-to-display `message`.
//! The `Display` impl yields exactly that human message, so `?`-propagation and
//! `format!` both do the right thing.

use serde::Serialize;

/// A typed, serialisable error for the Rust↔TS boundary.
///
/// Each variant carries a human-readable `message`; the `kind` tag is what the
/// frontend switches on. Add a variant rather than overloading `Internal` when a
/// new failure mode warrants distinct UI handling.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppError {
    /// The requested engine binary is not configured.
    EngineNotConfigured { message: String },
    /// No model is selected for the requested engine.
    ModelNotSelected { message: String },
    /// The selected model file does not exist on disk.
    ModelNotFound { message: String },
    /// The engine process failed to spawn.
    EngineSpawnFailed { message: String },
    /// The engine started but never became healthy within the deadline.
    EngineUnhealthy { message: String },
    /// The local engine could not be reached (connection refused/timeout).
    EngineUnreachable { message: String },
    /// The engine answered with a non-success HTTP status.
    EngineError { message: String },
    /// Computing or parsing embeddings failed.
    Embedding { message: String },
    /// A non-loopback request was blocked by air-gapped mode.
    AirgapBlocked { message: String },
    /// The vector index is unavailable; the caller should fall back to lexical
    /// retrieval. This is the degraded-but-running state, not a hard failure.
    VectorStoreUnavailable { message: String },
    /// A vector-store operation (open/insert/query) failed.
    VectorStore { message: String },
    /// Persisting or loading configuration failed.
    Config { message: String },
    /// The request itself was invalid (e.g. an empty corpus to index).
    InvalidInput { message: String },
    /// A GitHub integration operation (device flow, repo listing, clone) failed.
    Github { message: String },
}

impl AppError {
    /// The human-readable message carried by any variant.
    pub fn message(&self) -> &str {
        match self {
            AppError::EngineNotConfigured { message }
            | AppError::ModelNotSelected { message }
            | AppError::ModelNotFound { message }
            | AppError::EngineSpawnFailed { message }
            | AppError::EngineUnhealthy { message }
            | AppError::EngineUnreachable { message }
            | AppError::EngineError { message }
            | AppError::Embedding { message }
            | AppError::AirgapBlocked { message }
            | AppError::VectorStoreUnavailable { message }
            | AppError::VectorStore { message }
            | AppError::Config { message }
            | AppError::InvalidInput { message }
            | AppError::Github { message } => message,
        }
    }

    // Ergonomic constructors so call sites read `AppError::engine_error(e)` rather
    // than the struct-variant literal.
    pub fn engine_not_configured(m: impl Into<String>) -> Self {
        AppError::EngineNotConfigured { message: m.into() }
    }
    pub fn model_not_selected(m: impl Into<String>) -> Self {
        AppError::ModelNotSelected { message: m.into() }
    }
    pub fn model_not_found(m: impl Into<String>) -> Self {
        AppError::ModelNotFound { message: m.into() }
    }
    pub fn engine_spawn_failed(m: impl Into<String>) -> Self {
        AppError::EngineSpawnFailed { message: m.into() }
    }
    pub fn engine_unhealthy(m: impl Into<String>) -> Self {
        AppError::EngineUnhealthy { message: m.into() }
    }
    pub fn engine_unreachable(m: impl Into<String>) -> Self {
        AppError::EngineUnreachable { message: m.into() }
    }
    pub fn engine_error(m: impl Into<String>) -> Self {
        AppError::EngineError { message: m.into() }
    }
    pub fn embedding(m: impl Into<String>) -> Self {
        AppError::Embedding { message: m.into() }
    }
    pub fn airgap_blocked(m: impl Into<String>) -> Self {
        AppError::AirgapBlocked { message: m.into() }
    }
    pub fn vector_store_unavailable(m: impl Into<String>) -> Self {
        AppError::VectorStoreUnavailable { message: m.into() }
    }
    pub fn vector_store(m: impl Into<String>) -> Self {
        AppError::VectorStore { message: m.into() }
    }
    pub fn config(m: impl Into<String>) -> Self {
        AppError::Config { message: m.into() }
    }
    pub fn invalid_input(m: impl Into<String>) -> Self {
        AppError::InvalidInput { message: m.into() }
    }
    pub fn github(m: impl Into<String>) -> Self {
        AppError::Github { message: m.into() }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for AppError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_as_tagged_object() {
        let e = AppError::model_not_found("Model file not found: x.gguf");
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["kind"], "modelNotFound");
        assert_eq!(v["message"], "Model file not found: x.gguf");
    }

    #[test]
    fn display_is_the_human_message() {
        let e = AppError::engine_error("Engine returned 500");
        assert_eq!(e.to_string(), "Engine returned 500");
        assert_eq!(e.message(), "Engine returned 500");
    }

    #[test]
    fn distinct_kinds_are_distinguishable() {
        let a = serde_json::to_value(AppError::model_not_found("m")).unwrap();
        let b = serde_json::to_value(AppError::engine_unreachable("m")).unwrap();
        assert_ne!(a["kind"], b["kind"]);
    }
}

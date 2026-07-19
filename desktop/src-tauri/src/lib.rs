//! Libbie desktop — Tauri application entry point.
//!
//! The Rust core owns the local inference engine lifecycle and proxies all
//! OpenAI-compatible traffic to loopback ports, so the webview never touches the
//! network. See `engine.rs` (lifecycle), `inference.rs` (proxy), `config.rs`
//! (persisted settings) and `commands.rs` (the IPC surface).

mod commands;
mod config;
mod engine;
mod error;
mod github;
mod inference;
mod vecstore;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::get_hardware,
            commands::get_engine_choice,
            commands::engine_status,
            commands::start_engine,
            commands::stop_engine,
            commands::list_models,
            commands::ask_libbie,
            commands::embed_texts,
            commands::start_embed_engine,
            commands::stop_embed_engine,
            commands::embed_engine_status,
            commands::index_status,
            commands::build_index,
            commands::vector_search,
            commands::list_hf_gguf,
            commands::download_model,
            commands::github_login,
            commands::github_list_repos,
            commands::github_index_repo,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Libbie desktop")
        .run(|app_handle, event| {
            // Ensure the engine child is killed when the app exits.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<AppState>();
                let engine = state.engine.clone();
                tauri::async_runtime::block_on(async move {
                    engine.stop_all().await;
                });
            }
        });
}

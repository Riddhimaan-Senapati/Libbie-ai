//! OpenAI-compatible inference proxy.
//!
//! All model traffic is mediated here (never by the webview), so the UI makes
//! zero network calls and the air-gapped guarantee is enforced in Rust: the
//! only destinations are the loopback engine ports.

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use futures_util::StreamExt;

/// One chat message in the OpenAI schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Generation options forwarded to the engine.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatOptions {
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default = "default_top_p")]
    pub top_p: f32,
}

fn default_temperature() -> f32 {
    0.2
}
fn default_max_tokens() -> u32 {
    768
}
fn default_top_p() -> f32 {
    0.9
}

impl Default for ChatOptions {
    fn default() -> Self {
        ChatOptions {
            temperature: default_temperature(),
            max_tokens: default_max_tokens(),
            top_p: default_top_p(),
        }
    }
}

/// Streaming events pushed to the frontend over a Tauri channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    /// A newly generated text delta.
    Token { text: String },
    /// The stream finished normally.
    Done { finish_reason: String },
    /// The stream failed.
    Error { message: String },
}

/// Assert the destination is loopback before any request when offline mode is on.
pub fn assert_loopback(base_url: &str) -> Result<(), String> {
    let ok = base_url.contains("127.0.0.1")
        || base_url.contains("localhost")
        || base_url.contains("[::1]");
    if ok {
        Ok(())
    } else {
        Err(format!(
            "Air-gapped mode blocked a non-loopback request to {base_url}"
        ))
    }
}

/// Stream a chat completion, forwarding token deltas onto `channel`.
pub async fn stream_chat(
    client: &reqwest::Client,
    base_url: &str,
    messages: Vec<ChatMessage>,
    opts: ChatOptions,
    offline: bool,
    channel: &Channel<StreamEvent>,
) -> Result<(), String> {
    if offline {
        assert_loopback(base_url)?;
    }

    let url = format!("{}/v1/chat/completions", base_url);
    let body = serde_json::json!({
        "model": "local",
        "messages": messages,
        "temperature": opts.temperature,
        "top_p": opts.top_p,
        "max_tokens": opts.max_tokens,
        "stream": true,
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach the local engine: {e}"))?;

    if !resp.status().is_success() {
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Engine returned {code}: {text}"));
    }

    // Parse Server-Sent Events: lines beginning with "data: ".
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    let mut finish_reason = "stop".to_string();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Stream error: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        // Process complete lines; keep the trailing partial in `buf`.
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                let _ = channel.send(StreamEvent::Done {
                    finish_reason: finish_reason.clone(),
                });
                return Ok(());
            }
            if data.is_empty() {
                continue;
            }
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(choice) = json.get("choices").and_then(|c| c.get(0)) {
                    if let Some(reason) = choice.get("finish_reason").and_then(|r| r.as_str()) {
                        finish_reason = reason.to_string();
                    }
                    if let Some(text) = choice
                        .get("delta")
                        .and_then(|d| d.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        if !text.is_empty() {
                            let _ = channel.send(StreamEvent::Token {
                                text: text.to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    // Stream ended without an explicit [DONE].
    let _ = channel.send(StreamEvent::Done { finish_reason });
    Ok(())
}

/// Request embeddings for a batch of inputs (used by the RAG index).
pub async fn embed(
    client: &reqwest::Client,
    base_url: &str,
    inputs: Vec<String>,
    offline: bool,
) -> Result<Vec<Vec<f32>>, String> {
    if offline {
        assert_loopback(base_url)?;
    }
    let url = format!("{}/v1/embeddings", base_url);
    let body = serde_json::json!({ "model": "local", "input": inputs });
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach the embedding engine: {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Embedding engine returned {code}: {text}"));
    }
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Bad embedding response: {e}"))?;
    let mut out = Vec::new();
    if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(arr) = item.get("embedding").and_then(|e| e.as_array()) {
                out.push(
                    arr.iter()
                        .filter_map(|v| v.as_f64().map(|f| f as f32))
                        .collect(),
                );
            }
        }
    }
    Ok(out)
}

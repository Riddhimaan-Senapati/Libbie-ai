//! Inference proxy for every provider.
//!
//! All model traffic is mediated here (never by the webview). Requests are routed
//! by a resolved [`ProviderTarget`]: a local llama.cpp/vLLM server, any
//! OpenAI-compatible endpoint, or the Anthropic Messages API. For LOCAL targets
//! the air-gap is enforced in Rust — the only destination allowed is loopback.
//! Cloud targets are reachable only when the user has turned strict air-gap off
//! (validated in `config`), so page JS can never silently exfiltrate.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;

use futures_util::StreamExt;

use crate::config::ProviderTarget;

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

/// Assert the destination is genuinely loopback before any request.
///
/// The URL is parsed and its host matched exactly (see
/// `config::is_loopback_host`) — a substring test would accept
/// `http://127.0.0.1.evil.com` or `http://evil.com/?x=localhost`.
pub fn assert_loopback(base_url: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(base_url)
        .map_err(|e| format!("Air-gapped mode: unparseable engine URL {base_url:?} ({e})"))?;
    let host = url.host_str().unwrap_or("");
    if crate::config::is_loopback_host(host) {
        Ok(())
    } else {
        Err(format!(
            "Air-gapped mode blocked a non-loopback request to {base_url}"
        ))
    }
}

/// Build the provider-specific POST (URL, auth, body) for a streamed chat.
fn chat_request(
    client: &reqwest::Client,
    target: &ProviderTarget,
    messages: &[ChatMessage],
    opts: &ChatOptions,
) -> reqwest::RequestBuilder {
    if target.anthropic {
        // Anthropic: `system` is top-level; messages carry only user/assistant.
        let mut system = String::new();
        let mut msgs: Vec<Value> = Vec::new();
        for m in messages {
            if m.role == "system" {
                if !system.is_empty() {
                    system.push('\n');
                }
                system.push_str(&m.content);
            } else {
                msgs.push(json!({ "role": m.role, "content": m.content }));
            }
        }
        let mut body = json!({
            "model": target.model,
            "max_tokens": opts.max_tokens,   // required by Anthropic
            "messages": msgs,
            "temperature": opts.temperature,
            "top_p": opts.top_p,
            "stream": true,
        });
        if !system.is_empty() {
            body["system"] = json!(system);
        }
        let mut req = client
            .post(format!("{}/v1/messages", target.base_url))
            .header("anthropic-version", "2023-06-01")
            .json(&body);
        if let Some(key) = &target.api_key {
            req = req.header("x-api-key", key);
        }
        req
    } else {
        // OpenAI-compatible (local llama.cpp/vLLM or any cloud endpoint).
        let body = json!({
            "model": target.model,
            "messages": messages,
            "temperature": opts.temperature,
            "top_p": opts.top_p,
            "max_tokens": opts.max_tokens,
            "stream": true,
        });
        let mut req = client
            .post(format!("{}/chat/completions", target.base_url))
            .json(&body);
        if let Some(key) = &target.api_key {
            req = req.bearer_auth(key);
        }
        req
    }
}

/// Stream a chat completion from any provider, forwarding token deltas onto
/// `channel`. One SSE loop handles both wire formats:
///   * OpenAI-compatible: `data: {json}` with `choices[0].delta.content`, `[DONE]`.
///   * Anthropic: named events; text lives in `content_block_delta.delta.text`;
///     completion is `message_stop` (no `[DONE]`); `ping` etc. are ignored.
pub async fn stream_chat(
    client: &reqwest::Client,
    target: &ProviderTarget,
    messages: Vec<ChatMessage>,
    opts: ChatOptions,
    channel: &Channel<StreamEvent>,
) -> Result<(), String> {
    if target.is_local {
        assert_loopback(&target.base_url)?;
    }

    let resp = chat_request(client, target, &messages, &opts)
        .send()
        .await
        .map_err(|e| format!("Could not reach the model provider: {e}"))?;

    if !resp.status().is_success() {
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Provider returned {code}: {text}"));
    }

    let anthropic = target.anthropic;
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    let mut finish_reason = "stop".to_string();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Stream error: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            let Some(data) = line.strip_prefix("data:") else {
                continue; // ignore `event:` and comment lines
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if !anthropic && data == "[DONE]" {
                let _ = channel.send(StreamEvent::Done {
                    finish_reason: finish_reason.clone(),
                });
                return Ok(());
            }
            let Ok(json) = serde_json::from_str::<Value>(data) else {
                continue;
            };

            if anthropic {
                match json.get("type").and_then(|t| t.as_str()) {
                    Some("content_block_delta") => {
                        if json.pointer("/delta/type").and_then(|t| t.as_str()) == Some("text_delta")
                        {
                            if let Some(t) = json.pointer("/delta/text").and_then(|t| t.as_str()) {
                                if !t.is_empty() {
                                    let _ = channel.send(StreamEvent::Token { text: t.to_string() });
                                }
                            }
                        }
                    }
                    Some("message_delta") => {
                        if let Some(r) = json.pointer("/delta/stop_reason").and_then(|r| r.as_str()) {
                            finish_reason = r.to_string();
                        }
                    }
                    Some("message_stop") => {
                        let _ = channel.send(StreamEvent::Done {
                            finish_reason: finish_reason.clone(),
                        });
                        return Ok(());
                    }
                    Some("error") => {
                        let msg = json
                            .pointer("/error/message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("provider stream error")
                            .to_string();
                        let _ = channel.send(StreamEvent::Error { message: msg.clone() });
                        return Err(msg);
                    }
                    _ => {} // ping / message_start / content_block_start|stop / etc.
                }
            } else if let Some(choice) = json.get("choices").and_then(|c| c.get(0)) {
                if let Some(reason) = choice.get("finish_reason").and_then(|r| r.as_str()) {
                    finish_reason = reason.to_string();
                }
                if let Some(text) = choice
                    .pointer("/delta/content")
                    .and_then(|c| c.as_str())
                {
                    if !text.is_empty() {
                        let _ = channel.send(StreamEvent::Token { text: text.to_string() });
                    }
                }
            }
        }
    }

    let _ = channel.send(StreamEvent::Done { finish_reason });
    Ok(())
}

/// Request embeddings for a batch of inputs (used by the RAG index). Routes to a
/// local engine or an OpenAI-compatible cloud endpoint per the resolved target.
pub async fn embed(
    client: &reqwest::Client,
    target: &ProviderTarget,
    inputs: Vec<String>,
) -> Result<Vec<Vec<f32>>, String> {
    if target.is_local {
        assert_loopback(&target.base_url)?;
    }
    let mut req = client
        .post(format!("{}/embeddings", target.base_url))
        .json(&json!({ "model": target.model, "input": inputs }));
    if let Some(key) = &target.api_key {
        req = req.bearer_auth(key);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Could not reach the embedding provider: {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Embedding provider returned {code}: {text}"));
    }
    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("Bad embedding response: {e}"))?;
    // Sort by `index` when present so vector order matches input order.
    let mut rows: Vec<(i64, Vec<f32>)> = Vec::new();
    if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
        for (i, item) in data.iter().enumerate() {
            let idx = item.get("index").and_then(|v| v.as_i64()).unwrap_or(i as i64);
            let vec = item
                .get("embedding")
                .and_then(|e| e.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect())
                .unwrap_or_default();
            rows.push((idx, vec));
        }
    }
    rows.sort_by_key(|(i, _)| *i);
    Ok(rows.into_iter().map(|(_, v)| v).collect())
}

#[cfg(test)]
mod tests {
    use super::assert_loopback;

    #[test]
    fn loopback_urls_pass() {
        for u in [
            "http://127.0.0.1:51820/v1",
            "http://localhost:8080",
            "http://[::1]:51820/v1",
        ] {
            assert!(assert_loopback(u).is_ok(), "{u} should pass");
        }
    }

    #[test]
    fn non_loopback_and_spoofed_urls_fail() {
        for u in [
            "http://127.0.0.1.evil.com/v1", // substring-bypass attempt
            "https://api.openai.com/v1",
            "http://evil.com/?x=127.0.0.1",
            "not a url",
        ] {
            assert!(assert_loopback(u).is_err(), "{u} must be rejected");
        }
    }
}

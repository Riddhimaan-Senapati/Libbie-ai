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
use crate::error::AppError;

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
    /// Token accounting for the call, emitted once just before `Done`.
    /// `tokens_per_sec` is only known for local llama.cpp (from `timings`).
    Usage {
        input_tokens: u32,
        output_tokens: u32,
        tokens_per_sec: Option<f32>,
    },
    /// The stream finished normally.
    Done { finish_reason: String },
    /// The stream failed.
    Error { message: String },
}

/// Rough token count from a character length: `ceil(chars / 4)`. Used only as a
/// last-resort fallback when the provider reports no usage (no tokenizer dep).
fn est_tokens(chars: usize) -> u32 {
    ((chars + 3) / 4) as u32
}

/// Assert the destination is genuinely loopback before any request.
///
/// The URL is parsed and its host matched exactly (see
/// `config::is_loopback_host`) — a substring test would accept
/// `http://127.0.0.1.evil.com` or `http://evil.com/?x=localhost`.
pub fn assert_loopback(base_url: &str) -> Result<(), AppError> {
    let url = reqwest::Url::parse(base_url).map_err(|e| {
        AppError::airgap_blocked(format!(
            "Air-gapped mode: unparseable engine URL {base_url:?} ({e})"
        ))
    })?;
    let host = url.host_str().unwrap_or("");
    if crate::config::is_loopback_host(host) {
        Ok(())
    } else {
        Err(AppError::airgap_blocked(format!(
            "Air-gapped mode blocked a non-loopback request to {base_url}"
        )))
    }
}

/// Attach `Authorization: Bearer <key>` when the target carries an API key.
fn with_bearer(req: reqwest::RequestBuilder, key: &Option<String>) -> reqwest::RequestBuilder {
    match key {
        Some(k) => req.bearer_auth(k),
        None => req,
    }
}

/// Pass the response through when it is 2xx; otherwise fail with the body text.
async fn ensure_success(
    resp: reqwest::Response,
    what: &str,
) -> Result<reqwest::Response, AppError> {
    if resp.status().is_success() {
        Ok(resp)
    } else {
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(AppError::engine_error(format!("{what} returned {code}: {text}")))
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
        // `stream_options.include_usage` asks the server to emit a trailing
        // usage chunk (choices == [], usage populated) just before `[DONE]`.
        let body = json!({
            "model": target.model,
            "messages": messages,
            "temperature": opts.temperature,
            "top_p": opts.top_p,
            "max_tokens": opts.max_tokens,
            "stream": true,
            "stream_options": { "include_usage": true },
        });
        let req = client
            .post(format!("{}/chat/completions", target.base_url))
            .json(&body);
        with_bearer(req, &target.api_key)
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
) -> Result<(), AppError> {
    if target.is_local {
        assert_loopback(&target.base_url)?;
    }

    let resp = chat_request(client, target, &messages, &opts)
        .send()
        .await
        .map_err(|e| AppError::engine_unreachable(format!("Could not reach the model provider: {e}")))?;
    let resp = ensure_success(resp, "Provider").await?;

    let anthropic = target.anthropic;
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    let mut finish_reason = "stop".to_string();

    // Usage accounting. Provider-reported values win; `timings` (llama.cpp) is a
    // fallback for counts and the only source of tokens/sec; a char/4 estimate is
    // the last resort. `streamed_chars` feeds the output estimate.
    let mut usage_in: Option<u32> = None;
    let mut usage_out: Option<u32> = None;
    let mut timings_in: Option<u32> = None;
    let mut timings_out: Option<u32> = None;
    let mut tokens_per_sec: Option<f32> = None;
    let mut streamed_chars: usize = 0;

    // Resolve the final counts (provider → timings → estimate) and push a single
    // `Usage` event. Called immediately before every `Done`.
    let emit_usage = |channel: &Channel<StreamEvent>,
                      usage_in: Option<u32>,
                      usage_out: Option<u32>,
                      timings_in: Option<u32>,
                      timings_out: Option<u32>,
                      tokens_per_sec: Option<f32>,
                      streamed_chars: usize| {
        let input_tokens = usage_in.or(timings_in).unwrap_or_else(|| {
            // chars(), not len(): match the chars/4 intent (and the output path).
            est_tokens(messages.iter().map(|m| m.content.chars().count()).sum())
        });
        let output_tokens = usage_out
            .or(timings_out)
            .unwrap_or_else(|| est_tokens(streamed_chars));
        let _ = channel.send(StreamEvent::Usage {
            input_tokens,
            output_tokens,
            tokens_per_sec,
        });
    };

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| AppError::engine_error(format!("Stream error: {e}")))?;
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
                emit_usage(
                    channel, usage_in, usage_out, timings_in, timings_out,
                    tokens_per_sec, streamed_chars,
                );
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
                    Some("message_start") => {
                        if let Some(n) = json
                            .pointer("/message/usage/input_tokens")
                            .and_then(|v| v.as_u64())
                        {
                            usage_in = Some(n as u32);
                        }
                    }
                    Some("content_block_delta") => {
                        if json.pointer("/delta/type").and_then(|t| t.as_str()) == Some("text_delta")
                        {
                            if let Some(t) = json.pointer("/delta/text").and_then(|t| t.as_str()) {
                                if !t.is_empty() {
                                    streamed_chars += t.chars().count();
                                    let _ = channel.send(StreamEvent::Token { text: t.to_string() });
                                }
                            }
                        }
                    }
                    Some("message_delta") => {
                        if let Some(r) = json.pointer("/delta/stop_reason").and_then(|r| r.as_str()) {
                            finish_reason = r.to_string();
                        }
                        // Cumulative — the last value seen is the total.
                        if let Some(n) = json
                            .pointer("/usage/output_tokens")
                            .and_then(|v| v.as_u64())
                        {
                            usage_out = Some(n as u32);
                        }
                    }
                    Some("message_stop") => {
                        emit_usage(
                            channel, usage_in, usage_out, timings_in, timings_out,
                            tokens_per_sec, streamed_chars,
                        );
                        let _ = channel.send(StreamEvent::Done {
                            finish_reason: finish_reason.clone(),
                        });
                        return Ok(());
                    }
                    Some("error") => {
                        // Account partial usage before surfacing the error.
                        emit_usage(
                            channel, usage_in, usage_out, timings_in, timings_out,
                            tokens_per_sec, streamed_chars,
                        );
                        let msg = json
                            .pointer("/error/message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("provider stream error")
                            .to_string();
                        let _ = channel.send(StreamEvent::Error { message: msg.clone() });
                        return Err(AppError::engine_error(msg));
                    }
                    _ => {} // ping / content_block_start|stop / etc.
                }
            } else {
                // OpenAI-compatible. The trailing usage chunk has `choices: []`,
                // so read `usage`/`timings` regardless of the choices array.
                if let Some(usage) = json.get("usage") {
                    if let Some(n) = usage.get("prompt_tokens").and_then(|v| v.as_u64()) {
                        usage_in = Some(n as u32);
                    }
                    if let Some(n) = usage.get("completion_tokens").and_then(|v| v.as_u64()) {
                        usage_out = Some(n as u32);
                    }
                }
                if let Some(timings) = json.get("timings") {
                    if let Some(tps) =
                        timings.get("predicted_per_second").and_then(|v| v.as_f64())
                    {
                        tokens_per_sec = Some(tps as f32);
                    }
                    if let Some(n) = timings.get("prompt_n").and_then(|v| v.as_u64()) {
                        timings_in = Some(n as u32);
                    }
                    if let Some(n) = timings.get("predicted_n").and_then(|v| v.as_u64()) {
                        timings_out = Some(n as u32);
                    }
                }
                if let Some(choice) = json.get("choices").and_then(|c| c.get(0)) {
                    if let Some(reason) = choice.get("finish_reason").and_then(|r| r.as_str()) {
                        finish_reason = reason.to_string();
                    }
                    if let Some(text) = choice.pointer("/delta/content").and_then(|c| c.as_str()) {
                        if !text.is_empty() {
                            streamed_chars += text.chars().count();
                            let _ = channel.send(StreamEvent::Token { text: text.to_string() });
                        }
                    }
                }
            }
        }
    }

    emit_usage(
        channel, usage_in, usage_out, timings_in, timings_out, tokens_per_sec,
        streamed_chars,
    );
    let _ = channel.send(StreamEvent::Done { finish_reason });
    Ok(())
}

/// Request embeddings for a batch of inputs (used by the RAG index). Routes to a
/// local engine or an OpenAI-compatible cloud endpoint per the resolved target.
pub async fn embed(
    client: &reqwest::Client,
    target: &ProviderTarget,
    inputs: Vec<String>,
) -> Result<Vec<Vec<f32>>, AppError> {
    if target.is_local {
        assert_loopback(&target.base_url)?;
    }
    let req = client
        .post(format!("{}/embeddings", target.base_url))
        .json(&json!({ "model": target.model, "input": inputs }));
    let resp = with_bearer(req, &target.api_key)
        .send()
        .await
        .map_err(|e| {
            AppError::engine_unreachable(format!("Could not reach the embedding provider: {e}"))
        })?;
    let resp = ensure_success(resp, "Embedding provider").await?;
    let json: Value = resp
        .json()
        .await
        .map_err(|e| AppError::embedding(format!("Bad embedding response: {e}")))?;
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

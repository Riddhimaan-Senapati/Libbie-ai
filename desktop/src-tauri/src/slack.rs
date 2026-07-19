//! Slack connector — connect a user's own account and index their message
//! history into the RAG store.
//!
//! Two auth paths are supported (mirroring the GitHub integration's "no secret
//! in the binary" stance where possible):
//!
//! * **Token paste (primary):** the user pastes a `xoxp-`/`xoxb-` token, which we
//!   validate with `auth.test`. Nothing is embedded in the binary and no browser
//!   round-trip is needed.
//! * **OAuth v2 loopback (optional):** we open Slack's authorize URL in the
//!   user's browser and catch the `?code&state` redirect on a FIXED loopback port
//!   with a one-shot `tiny_http` listener, then exchange the code for a token via
//!   `oauth.v2.access`. The *user* token is `authed_user.access_token`. Slack does
//!   not allow arbitrary redirect ports — the port must match a URL registered on
//!   the Slack app — so the port is fixed (default 3118, override with
//!   `LIBBIE_SLACK_REDIRECT_PORT`). `client_id`/`client_secret` come from config or
//!   the `LIBBIE_SLACK_CLIENT_ID` / `LIBBIE_SLACK_CLIENT_SECRET` env vars.
//!
//! All traffic goes through `reqwest` directly (already a dep). Web API calls use
//! cursor pagination and honour `Retry-After` on HTTP 429 (Tier-3 endpoints are
//! rate-limited to ~50/min).
//!
//! Security notes
//! --------------
//! * The token is held in the Rust core (redacted from the webview, never logged).
//! * The OAuth loopback binds `127.0.0.1` only and matches the CSRF `state` before
//!   accepting a code.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::oauth;

// --------------------------------------------------------------------------- //
// Endpoints / constants
// --------------------------------------------------------------------------- //
const AUTH_TEST_URL: &str = "https://slack.com/api/auth.test";
const CONVERSATIONS_LIST_URL: &str = "https://slack.com/api/conversations.list";
const CONVERSATIONS_HISTORY_URL: &str = "https://slack.com/api/conversations.history";
const OAUTH_ACCESS_URL: &str = "https://slack.com/api/oauth.v2.access";
const AUTHORIZE_BASE: &str = "https://slack.com/oauth/v2/authorize";

/// User scopes requested for reading a user's own history across conversation
/// types plus the metadata needed to render names.
pub const USER_SCOPES: &str =
    "channels:history,groups:history,im:history,mpim:history,channels:read,groups:read,users:read";

/// The FIXED loopback port Slack redirects the OAuth code to. Slack only allows a
/// redirect URI that exactly matches one registered on the app, so this cannot be
/// an arbitrary/ephemeral port. Override with `LIBBIE_SLACK_REDIRECT_PORT`.
pub const DEFAULT_REDIRECT_PORT: u16 = 3118;

/// Hard cap on messages pulled from a single conversation, to bound work/memory.
const MAX_MESSAGES_PER_CHANNEL: usize = 2000;
/// Slack `conversations.history` allows up to 999 per page.
const HISTORY_PAGE_LIMIT: u32 = 200;

// --------------------------------------------------------------------------- //
// Models
// --------------------------------------------------------------------------- //

/// A conversation the token can read. Serialised to the webview for the picker.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SlackChannel {
    pub id: String,
    pub name: String,
    pub is_private: bool,
    pub is_im: bool,
}

/// One raw message pulled from `conversations.history`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackMessage {
    pub ts: String,
    pub text: String,
    pub user: String,
    /// Present when the message belongs to a thread; the value is the root ts.
    pub thread_ts: Option<String>,
}

/// Result of `auth.test` — confirms the token and names the workspace/user.
#[derive(Debug, Clone, Serialize)]
pub struct SlackIdentity {
    pub team: String,
    pub user: String,
}

// --------------------------------------------------------------------------- //
// OAuth URL construction (pure, unit-tested)
// --------------------------------------------------------------------------- //

/// The redirect URI the loopback listener serves. `localhost` (not `127.0.0.1`)
/// because that is the human-friendly form typically registered on a Slack app.
pub fn redirect_uri(port: u16) -> String {
    format!("http://localhost:{port}/callback")
}

/// Build Slack's OAuth v2 authorize URL for the user-token flow.
pub fn build_authorize_url(client_id: &str, port: u16, state: &str) -> String {
    let redirect = redirect_uri(port);
    format!(
        "{AUTHORIZE_BASE}?client_id={}&user_scope={}&redirect_uri={}&state={}",
        oauth::urlencode(client_id),
        oauth::urlencode(USER_SCOPES),
        oauth::urlencode(&redirect),
        oauth::urlencode(state),
    )
}

/// Catch the Slack OAuth redirect on the FIXED loopback port and return the
/// `code`. Runs synchronously — call from `spawn_blocking`.
pub fn catch_oauth_code(
    port: u16,
    expected_state: &str,
    timeout: Duration,
) -> Result<String, String> {
    let server = oauth::bind_fixed(port)?;
    oauth::recv_oauth_code(server, expected_state, timeout)
}

// --------------------------------------------------------------------------- //
// Web API
// --------------------------------------------------------------------------- //

/// Exchange an OAuth `code` for the user's access token via `oauth.v2.access`.
/// The *user* token is `authed_user.access_token` (not the top-level bot token).
pub async fn exchange_code(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    code: &str,
    port: u16,
) -> Result<String, String> {
    let redirect = redirect_uri(port);
    let resp = client
        .post(OAUTH_ACCESS_URL)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("redirect_uri", &redirect),
        ])
        .send()
        .await
        .map_err(|e| format!("Could not reach Slack: {e}"))?;
    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected oauth.v2.access response: {e}"))?;
    if data.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(slack_error(&data, "oauth.v2.access"));
    }
    data.pointer("/authed_user/access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Slack did not return a user access token.".to_string())
}

/// Validate a token and return the workspace + user it belongs to.
pub async fn auth_test(client: &reqwest::Client, token: &str) -> Result<SlackIdentity, String> {
    let resp = client
        .post(AUTH_TEST_URL)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Could not reach Slack: {e}"))?;
    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected auth.test response: {e}"))?;
    if data.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(slack_error(&data, "auth.test"));
    }
    Ok(SlackIdentity {
        team: data
            .get("team")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        user: data
            .get("user")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

/// List every conversation the token can read (public/private channels, DMs, and
/// group DMs), following cursor pagination.
pub async fn list_channels(
    client: &reqwest::Client,
    token: &str,
) -> Result<Vec<SlackChannel>, String> {
    let mut out: Vec<SlackChannel> = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut query: Vec<(&str, String)> = vec![
            (
                "types",
                "public_channel,private_channel,mpim,im".to_string(),
            ),
            ("limit", "200".to_string()),
            ("exclude_archived", "true".to_string()),
        ];
        if let Some(c) = &cursor {
            query.push(("cursor", c.clone()));
        }
        let data = get_json(client, CONVERSATIONS_LIST_URL, token, &query).await?;
        if data.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            return Err(slack_error(&data, "conversations.list"));
        }
        if let Some(chans) = data.get("channels").and_then(|c| c.as_array()) {
            for c in chans {
                out.push(parse_channel(c));
            }
        }
        cursor = next_cursor(&data);
        if cursor.is_none() {
            break;
        }
    }
    Ok(out)
}

/// Fetch (most-recent-first) message history for a conversation, following cursor
/// pagination and honouring `Retry-After` on 429. Capped at
/// `MAX_MESSAGES_PER_CHANNEL`.
pub async fn fetch_history(
    client: &reqwest::Client,
    token: &str,
    channel_id: &str,
) -> Result<Vec<SlackMessage>, String> {
    let mut out: Vec<SlackMessage> = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut query: Vec<(&str, String)> = vec![
            ("channel", channel_id.to_string()),
            ("limit", HISTORY_PAGE_LIMIT.to_string()),
        ];
        if let Some(c) = &cursor {
            query.push(("cursor", c.clone()));
        }
        let data = get_json(client, CONVERSATIONS_HISTORY_URL, token, &query).await?;
        if data.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            return Err(slack_error(&data, "conversations.history"));
        }
        if let Some(msgs) = data.get("messages").and_then(|m| m.as_array()) {
            for m in msgs {
                if let Some(msg) = parse_message(m) {
                    out.push(msg);
                }
                if out.len() >= MAX_MESSAGES_PER_CHANNEL {
                    return Ok(out);
                }
            }
        }
        cursor = next_cursor(&data);
        if cursor.is_none() {
            break;
        }
    }
    Ok(out)
}

/// GET a Slack Web API endpoint with the token, retrying once on HTTP 429 after
/// the server's `Retry-After` (Tier-3 endpoints are rate-limited).
async fn get_json(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    query: &[(&str, String)],
) -> Result<Value, String> {
    for attempt in 0..4 {
        let resp = client
            .get(url)
            .bearer_auth(token)
            .query(query)
            .send()
            .await
            .map_err(|e| format!("Could not reach Slack: {e}"))?;
        if resp.status().as_u16() == 429 {
            let wait = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(2);
            if attempt == 3 {
                return Err("Slack rate limit exceeded; try again shortly.".to_string());
            }
            tokio::time::sleep(Duration::from_secs(wait.clamp(1, 30))).await;
            continue;
        }
        if !resp.status().is_success() {
            return Err(format!("Slack returned {} for {url}", resp.status()));
        }
        return resp
            .json::<Value>()
            .await
            .map_err(|e| format!("Unexpected Slack response: {e}"));
    }
    Err("Slack rate limit exceeded; try again shortly.".to_string())
}

// --------------------------------------------------------------------------- //
// Parsing helpers (pure, unit-tested)
// --------------------------------------------------------------------------- //

/// `response_metadata.next_cursor` when non-empty, else `None` (end of pages).
fn next_cursor(data: &Value) -> Option<String> {
    data.pointer("/response_metadata/next_cursor")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Human-readable error from a `{ok:false, error, ...}` Slack payload.
fn slack_error(data: &Value, what: &str) -> String {
    let err = data
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown_error");
    format!("Slack {what} failed: {err}")
}

fn parse_channel(c: &Value) -> SlackChannel {
    let id = c
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let is_im = c.get("is_im").and_then(|v| v.as_bool()).unwrap_or(false);
    let is_private = c
        .get("is_private")
        .and_then(|v| v.as_bool())
        .unwrap_or(is_im);
    // DMs have no name; fall back to the user id / channel id for display.
    let name = c
        .get("name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            if is_im {
                let u = c.get("user").and_then(|v| v.as_str()).unwrap_or(&id);
                format!("dm-{u}")
            } else {
                id.clone()
            }
        });
    SlackChannel {
        id,
        name,
        is_private,
        is_im,
    }
}

/// Parse a history entry into a `SlackMessage`, skipping non-user events (joins,
/// bot subtypes without text, etc.) and empty messages.
fn parse_message(m: &Value) -> Option<SlackMessage> {
    if m.get("type").and_then(|v| v.as_str()) != Some("message") {
        return None;
    }
    let text = m.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
    if text.is_empty() {
        return None;
    }
    let ts = m.get("ts").and_then(|v| v.as_str())?.to_string();
    let user = m
        .get("user")
        .or_else(|| m.get("bot_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let thread_ts = m
        .get("thread_ts")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(SlackMessage {
        ts,
        text: text.to_string(),
        user,
        thread_ts,
    })
}

/// The thread root ts for a message: its `thread_ts` when threaded, else its own
/// `ts`. Used to group messages of the same thread into one conversation id.
pub fn thread_root(msg: &SlackMessage) -> &str {
    msg.thread_ts.as_deref().unwrap_or(&msg.ts)
}

/// Build the `(conv_id, text)` pair for a message chunk. `conv_id` groups a whole
/// thread (`slack:<channel>:<root-ts>`) so decisions cluster per discussion; the
/// text is a compact, self-describing record for embedding.
pub fn message_chunk(
    channel: &SlackChannel,
    users: &HashMap<String, String>,
    msg: &SlackMessage,
) -> (String, String) {
    let conv_id = format!("slack:{}:{}", channel.id, thread_root(msg));
    let who = users
        .get(&msg.user)
        .cloned()
        .unwrap_or_else(|| msg.user.clone());
    let channel_label = if channel.is_im {
        channel.name.clone()
    } else {
        format!("#{}", channel.name)
    };
    let text = format!(
        "Slack {channel_label} — {who} (ts {}):\n{}",
        msg.ts, msg.text
    );
    (conv_id, text)
}

/// Fetch a `user id -> display name` map via `users.list` (best effort; an empty
/// map is fine — ids are then shown verbatim). Requires the `users:read` scope.
pub async fn user_directory(
    client: &reqwest::Client,
    token: &str,
) -> Result<HashMap<String, String>, String> {
    let mut out: HashMap<String, String> = HashMap::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut query: Vec<(&str, String)> = vec![("limit", "200".to_string())];
        if let Some(c) = &cursor {
            query.push(("cursor", c.clone()));
        }
        let data = get_json(client, "https://slack.com/api/users.list", token, &query).await?;
        if data.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            // users:read may be missing — degrade gracefully to ids.
            return Ok(out);
        }
        if let Some(members) = data.get("members").and_then(|m| m.as_array()) {
            for u in members {
                let id = u.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let name = u
                    .pointer("/profile/display_name")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .or_else(|| u.get("real_name").and_then(|v| v.as_str()))
                    .or_else(|| u.get("name").and_then(|v| v.as_str()))
                    .unwrap_or("");
                if !id.is_empty() && !name.is_empty() {
                    out.insert(id.to_string(), name.to_string());
                }
            }
        }
        cursor = next_cursor(&data);
        if cursor.is_none() {
            break;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorize_url_has_fixed_redirect_and_scopes() {
        let url = build_authorize_url("Iv1.abc123", DEFAULT_REDIRECT_PORT, "state-xyz");
        assert!(url.starts_with(AUTHORIZE_BASE));
        assert!(url.contains("client_id=Iv1.abc123"));
        // Redirect uri is percent-encoded and uses the FIXED port.
        assert!(url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A3118%2Fcallback"));
        assert!(url.contains("state=state-xyz"));
        // User scopes are present (encoded commas).
        assert!(url.contains("user_scope=channels%3Ahistory"));
    }

    #[test]
    fn next_cursor_stops_on_empty() {
        let with = serde_json::json!({"response_metadata": {"next_cursor": "abc"}});
        assert_eq!(next_cursor(&with).as_deref(), Some("abc"));
        let empty = serde_json::json!({"response_metadata": {"next_cursor": ""}});
        assert_eq!(next_cursor(&empty), None);
        assert_eq!(next_cursor(&serde_json::json!({})), None);
    }

    #[test]
    fn parse_message_skips_non_text_and_events() {
        let join = serde_json::json!({"type":"message","subtype":"channel_join","ts":"1.0"});
        assert!(parse_message(&join).is_none());
        let empty = serde_json::json!({"type":"message","text":"   ","ts":"1.0","user":"U1"});
        assert!(parse_message(&empty).is_none());
        let ok = serde_json::json!({"type":"message","text":"hi","ts":"1.1","user":"U1"});
        let m = parse_message(&ok).unwrap();
        assert_eq!(m.text, "hi");
        assert_eq!(m.user, "U1");
        assert!(m.thread_ts.is_none());
    }

    #[test]
    fn thread_root_prefers_thread_ts() {
        let root = SlackMessage {
            ts: "100.1".into(),
            text: "x".into(),
            user: "U1".into(),
            thread_ts: None,
        };
        assert_eq!(thread_root(&root), "100.1");
        let reply = SlackMessage {
            ts: "100.9".into(),
            text: "y".into(),
            user: "U2".into(),
            thread_ts: Some("100.1".into()),
        };
        assert_eq!(thread_root(&reply), "100.1");
    }

    #[test]
    fn message_chunk_groups_thread_and_resolves_user() {
        let chan = SlackChannel {
            id: "C1".into(),
            name: "eng".into(),
            is_private: false,
            is_im: false,
        };
        let mut users = HashMap::new();
        users.insert("U1".to_string(), "Ada".to_string());
        let reply = SlackMessage {
            ts: "100.9".into(),
            text: "ship it".into(),
            user: "U1".into(),
            thread_ts: Some("100.1".into()),
        };
        let (conv_id, text) = message_chunk(&chan, &users, &reply);
        // Whole thread shares one conv id keyed on the root ts.
        assert_eq!(conv_id, "slack:C1:100.1");
        assert!(text.contains("#eng"));
        assert!(text.contains("Ada"));
        assert!(text.contains("ship it"));
    }

    #[test]
    fn parse_channel_handles_dm_without_name() {
        let dm = serde_json::json!({"id":"D1","is_im":true,"user":"U9"});
        let c = parse_channel(&dm);
        assert_eq!(c.id, "D1");
        assert!(c.is_im && c.is_private);
        assert_eq!(c.name, "dm-U9");
    }
}

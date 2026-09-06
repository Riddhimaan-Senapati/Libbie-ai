//! Email connector — index a user's mail into the RAG store from either:
//!
//! * **Gmail (OAuth loopback):** the installed-app flow with PKCE. We bind an
//!   ephemeral loopback port, open Google's consent screen, catch the redirect,
//!   and exchange the code (with `code_verifier` + optional client secret) for an
//!   access token. Scope is read-only (`gmail.readonly`). Messages are pulled via
//!   `users.messages.list` + `.get`.
//! * **IMAP (any provider, app password):** a direct TLS connection using
//!   `async-imap` over a **rustls** layer that matches reqwest's `rustls-tls`
//!   (ring provider), so no OpenSSL/native-tls or second crypto backend is pulled
//!   in. We `LOGIN`, `LIST` mailboxes, `SELECT`, and `FETCH RFC822`, parsing each
//!   message with `mail-parser`.
//!
//! Threading (both paths): a message's conversation is keyed on the thread ROOT,
//! not its own id. Gmail gives an authoritative `threadId`; for IMAP we resolve
//! the root from `References` (first id) / `In-Reply-To`, falling back to the
//! message's own `Message-ID` (see `thread_root_email`).
//!
//! Security notes
//! --------------
//! * Tokens and the IMAP app password live in the Rust core (redacted from the
//!   webview, never logged).
//! * The OAuth loopback binds `127.0.0.1` only and validates the CSRF `state`.

use std::sync::Arc;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::oauth;

// --------------------------------------------------------------------------- //
// Endpoints / constants
// --------------------------------------------------------------------------- //
const GMAIL_AUTHORIZE: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_TOKEN: &str = "https://oauth2.googleapis.com/token";
const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";

/// Cap on messages pulled from a single Gmail label / IMAP mailbox.
const MAX_MESSAGES: usize = 500;
/// Cap on a single message body carried into an embedding chunk.
const MAX_BODY_CHARS: usize = 8000;

// --------------------------------------------------------------------------- //
// Models
// --------------------------------------------------------------------------- //

/// A selectable Gmail label or IMAP mailbox. `id` is what the fetch call takes
/// (a Gmail label id or an IMAP mailbox name); `name` is the display label.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EmailFolder {
    pub id: String,
    pub name: String,
}

/// A normalised email ready to become an embedding chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailRecord {
    pub message_id: String,
    /// The thread ROOT identifier used to cluster a conversation.
    pub thread_root: String,
    pub from: String,
    pub subject: String,
    pub date: String,
    pub body: String,
}

/// Connection parameters for the IMAP path.
#[derive(Debug, Clone)]
pub struct ImapConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
}

// --------------------------------------------------------------------------- //
// Gmail OAuth (pure URL construction is unit-tested)
// --------------------------------------------------------------------------- //

/// The loopback redirect URI for the Gmail installed-app flow. Google accepts any
/// loopback port for a Desktop client, so this uses the ephemeral bound port.
pub fn gmail_redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// Build Google's OAuth authorize URL (PKCE S256, read-only Gmail scope).
pub fn build_gmail_authorize_url(
    client_id: &str,
    port: u16,
    state: &str,
    challenge: &str,
) -> String {
    format!(
        "{GMAIL_AUTHORIZE}?client_id={}&redirect_uri={}&response_type=code&scope={}\
         &code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent&state={}",
        oauth::urlencode(client_id),
        oauth::urlencode(&gmail_redirect_uri(port)),
        oauth::urlencode(GMAIL_SCOPE),
        oauth::urlencode(challenge),
        oauth::urlencode(state),
    )
}

/// Exchange the authorization code for an access token (PKCE verifier + optional
/// installed-app client secret).
pub async fn gmail_exchange_code(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    port: u16,
    verifier: &str,
) -> Result<String, String> {
    let redirect = gmail_redirect_uri(port);
    let mut form: Vec<(&str, &str)> = vec![
        ("code", code),
        ("client_id", client_id),
        ("grant_type", "authorization_code"),
        ("redirect_uri", &redirect),
        ("code_verifier", verifier),
    ];
    if let Some(secret) = client_secret {
        if !secret.is_empty() {
            form.push(("client_secret", secret));
        }
    }
    let resp = client
        .post(GMAIL_TOKEN)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Could not reach Google: {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Google token exchange returned {code}: {body}"));
    }
    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected token response from Google: {e}"))?;
    data.get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Google did not return an access token.".to_string())
}

// --------------------------------------------------------------------------- //
// Gmail REST
// --------------------------------------------------------------------------- //

/// List the account's labels (system + user) for the picker.
pub async fn gmail_list_labels(
    client: &reqwest::Client,
    token: &str,
) -> Result<Vec<EmailFolder>, String> {
    let data = gmail_get(client, token, &format!("{GMAIL_API}/labels")).await?;
    let mut out = Vec::new();
    if let Some(labels) = data.get("labels").and_then(|l| l.as_array()) {
        for l in labels {
            let id = l.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let name = l.get("name").and_then(|v| v.as_str()).unwrap_or(id);
            if !id.is_empty() {
                out.push(EmailFolder {
                    id: id.to_string(),
                    name: name.to_string(),
                });
            }
        }
    }
    Ok(out)
}

/// Collect up to `MAX_MESSAGES` message ids for a label (or all mail), following
/// `nextPageToken`.
pub async fn gmail_list_message_ids(
    client: &reqwest::Client,
    token: &str,
    label: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut ids: Vec<String> = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut url = format!("{GMAIL_API}/messages?maxResults=100");
        if let Some(l) = label {
            if !l.is_empty() {
                url.push_str(&format!("&labelIds={}", oauth::urlencode(l)));
            }
        }
        if let Some(t) = &page_token {
            url.push_str(&format!("&pageToken={}", oauth::urlencode(t)));
        }
        let data = gmail_get(client, token, &url).await?;
        if let Some(msgs) = data.get("messages").and_then(|m| m.as_array()) {
            for m in msgs {
                if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                    ids.push(id.to_string());
                    if ids.len() >= MAX_MESSAGES {
                        return Ok(ids);
                    }
                }
            }
        }
        page_token = data
            .get("nextPageToken")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if page_token.is_none() {
            break;
        }
    }
    Ok(ids)
}

/// Fetch and normalise a single Gmail message (`format=full`).
pub async fn gmail_get_message(
    client: &reqwest::Client,
    token: &str,
    id: &str,
) -> Result<EmailRecord, String> {
    let url = format!("{GMAIL_API}/messages/{}?format=full", oauth::urlencode(id));
    let data = gmail_get(client, token, &url).await?;
    Ok(parse_gmail_message(&data))
}

/// Fetch and normalise Gmail messages with bounded concurrency (8 in flight),
/// preserving `ids` order. Each request goes through the 429-aware `gmail_get`
/// backoff; the first failure fails the whole batch (same as the old
/// sequential loop).
pub async fn gmail_get_messages(
    client: &reqwest::Client,
    token: &str,
    ids: &[String],
    mut on_progress: impl FnMut(usize, usize),
) -> Result<Vec<EmailRecord>, String> {
    use futures_util::StreamExt;

    let total = ids.len();
    let fetched: Vec<Result<EmailRecord, String>> = futures_util::stream::iter(ids.iter().cloned())
        .map(|id| async move { gmail_get_message(client, token, &id).await })
        .buffered(8)
        .collect()
        .await;

    let mut out = Vec::with_capacity(total);
    for (done, res) in fetched.into_iter().enumerate() {
        out.push(res?);
        on_progress(done + 1, total);
    }
    Ok(out)
}

async fn gmail_get(client: &reqwest::Client, token: &str, url: &str) -> Result<Value, String> {
    for attempt in 0..4 {
        let resp = client
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Could not reach Google: {e}"))?;
        let status = resp.status();
        if status.as_u16() == 429 || status.as_u16() == 403 {
            // Back off on rate-limit / userRateLimitExceeded.
            if attempt < 3 {
                tokio::time::sleep(std::time::Duration::from_secs(1 << attempt)).await;
                continue;
            }
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Gmail API returned {status}: {body}"));
        }
        return resp
            .json::<Value>()
            .await
            .map_err(|e| format!("Unexpected Gmail response: {e}"));
    }
    Err("Gmail rate limit exceeded; try again shortly.".to_string())
}

/// Parse a Gmail `messages.get` (format=full) payload into an `EmailRecord`.
fn parse_gmail_message(data: &Value) -> EmailRecord {
    let thread_id = data
        .get("threadId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let empty = Vec::new();
    let headers = data
        .pointer("/payload/headers")
        .and_then(|h| h.as_array())
        .unwrap_or(&empty);
    let hdr = |name: &str| gmail_header(headers, name);
    let message_id = hdr("Message-ID")
        .or_else(|| hdr("Message-Id"))
        .unwrap_or_default()
        .trim_matches(|c| c == '<' || c == '>')
        .to_string();
    let body = data
        .get("payload")
        .and_then(extract_gmail_body)
        .or_else(|| {
            data.get("snippet")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();
    EmailRecord {
        message_id,
        thread_root: thread_id,
        from: hdr("From").unwrap_or_default(),
        subject: hdr("Subject").unwrap_or_default(),
        date: hdr("Date").unwrap_or_default(),
        body: clamp(&body, MAX_BODY_CHARS),
    }
}

/// Case-insensitive lookup in a Gmail headers array (`[{name,value}]`).
fn gmail_header(headers: &[Value], name: &str) -> Option<String> {
    headers.iter().find_map(|h| {
        let n = h.get("name").and_then(|v| v.as_str())?;
        if n.eq_ignore_ascii_case(name) {
            h.get("value")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        } else {
            None
        }
    })
}

/// Walk a Gmail MIME payload for the first non-empty `text/plain` part, decoding
/// its base64url body.
fn extract_gmail_body(payload: &Value) -> Option<String> {
    let mime = payload
        .get("mimeType")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if mime == "text/plain" {
        if let Some(data) = payload.pointer("/body/data").and_then(|v| v.as_str()) {
            if let Some(bytes) = oauth::base64url_decode(data) {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                if !text.trim().is_empty() {
                    return Some(text);
                }
            }
        }
    }
    if let Some(parts) = payload.get("parts").and_then(|p| p.as_array()) {
        for p in parts {
            if let Some(text) = extract_gmail_body(p) {
                if !text.trim().is_empty() {
                    return Some(text);
                }
            }
        }
    }
    None
}

// --------------------------------------------------------------------------- //
// IMAP over rustls
// --------------------------------------------------------------------------- //

/// Build a rustls client config using the **ring** provider (matching reqwest's
/// `rustls-tls`) and the webpki root bundle already in the tree.
fn tls_config() -> Result<Arc<tokio_rustls::rustls::ClientConfig>, String> {
    use tokio_rustls::rustls::{ClientConfig, RootCertStore};
    let mut roots = RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let provider = Arc::new(tokio_rustls::rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("Could not initialise TLS: {e}"))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Arc::new(config))
}

/// Open a TLS IMAP connection and log in, returning an authenticated session.
async fn imap_login(
    cfg: &ImapConfig,
) -> Result<async_imap::Session<tokio_rustls::client::TlsStream<tokio::net::TcpStream>>, String> {
    use tokio_rustls::rustls::pki_types::ServerName;
    use tokio_rustls::TlsConnector;

    let tcp = tokio::net::TcpStream::connect((cfg.host.as_str(), cfg.port))
        .await
        .map_err(|e| format!("Could not connect to {}:{}: {e}", cfg.host, cfg.port))?;
    let connector = TlsConnector::from(tls_config()?);
    let server_name = ServerName::try_from(cfg.host.clone())
        .map_err(|_| format!("Invalid IMAP host name: {:?}", cfg.host))?;
    let tls = connector
        .connect(server_name, tcp)
        .await
        .map_err(|e| format!("TLS handshake with {} failed: {e}", cfg.host))?;

    let mut client = async_imap::Client::new(tls);
    // Consume the server greeting before issuing LOGIN.
    let _greeting = client
        .read_response()
        .await
        .map_err(|e| format!("IMAP greeting error: {e}"))?
        .ok_or_else(|| "IMAP server closed before greeting.".to_string())?;
    client
        .login(&cfg.user, &cfg.password)
        .await
        .map_err(|(e, _client)| format!("IMAP login failed: {e}"))
}

/// List the mailboxes (folders) available to the account.
pub async fn imap_list_mailboxes(cfg: &ImapConfig) -> Result<Vec<EmailFolder>, String> {
    let mut session = imap_login(cfg).await?;
    let mut names: Vec<EmailFolder> = Vec::new();
    {
        let mut stream = session
            .list(Some(""), Some("*"))
            .await
            .map_err(|e| format!("IMAP LIST failed: {e}"))?;
        while let Some(item) = stream.next().await {
            match item {
                Ok(name) => {
                    let n = name.name().to_string();
                    names.push(EmailFolder {
                        id: n.clone(),
                        name: n,
                    });
                }
                Err(e) => return Err(format!("IMAP LIST error: {e}")),
            }
        }
    }
    let _ = session.logout().await;
    Ok(names)
}

/// Select a mailbox and fetch the most recent (up to `MAX_MESSAGES`) messages,
/// parsing each into an `EmailRecord`.
pub async fn imap_fetch(cfg: &ImapConfig, mailbox: &str) -> Result<Vec<EmailRecord>, String> {
    let mut session = imap_login(cfg).await?;
    let mbox = session
        .select(mailbox)
        .await
        .map_err(|e| format!("Could not open mailbox {mailbox:?}: {e}"))?;
    let exists = mbox.exists;
    let mut raws: Vec<Vec<u8>> = Vec::new();
    if exists > 0 {
        let start = exists.saturating_sub(MAX_MESSAGES as u32 - 1).max(1);
        let range = format!("{start}:{exists}");
        {
            let mut stream = session
                .fetch(range, "RFC822")
                .await
                .map_err(|e| format!("IMAP FETCH failed: {e}"))?;
            while let Some(item) = stream.next().await {
                let fetch = item.map_err(|e| format!("IMAP FETCH error: {e}"))?;
                if let Some(body) = fetch.body() {
                    raws.push(body.to_vec());
                }
            }
        }
    }
    let _ = session.logout().await;
    Ok(raws.iter().map(|r| parse_rfc822(r)).collect())
}

// --------------------------------------------------------------------------- //
// RFC822 parsing + threading (pure, unit-tested)
// --------------------------------------------------------------------------- //

/// Parse a raw RFC822 message into an `EmailRecord`. Uses `mail-parser` for the
/// subject/body (MIME + RFC2047 decoding) and a minimal header scan for the
/// threading ids so the thread logic is dependency-free and testable.
pub fn parse_rfc822(raw: &[u8]) -> EmailRecord {
    let raw_str = String::from_utf8_lossy(raw);
    let headers = unfold_headers(&raw_str);
    let own = header(&headers, "message-id").unwrap_or("");
    let thread_root = thread_root_email(
        own,
        header(&headers, "in-reply-to"),
        header(&headers, "references"),
    );
    let from = header(&headers, "from").unwrap_or("").to_string();
    let date = header(&headers, "date").unwrap_or("").to_string();

    let (subject, body) = match mail_parser::MessageParser::default().parse(raw) {
        Some(m) => (
            m.subject()
                .map(|s| s.to_string())
                .or_else(|| header(&headers, "subject").map(|s| s.to_string()))
                .unwrap_or_default(),
            m.body_text(0).map(|c| c.into_owned()).unwrap_or_default(),
        ),
        None => (
            header(&headers, "subject").unwrap_or("").to_string(),
            String::new(),
        ),
    };

    EmailRecord {
        message_id: own
            .trim()
            .trim_matches(|c| c == '<' || c == '>')
            .to_string(),
        thread_root,
        from,
        subject,
        date,
        body: clamp(&body, MAX_BODY_CHARS),
    }
}

/// Unfold RFC822 headers (joining continuation lines) into `(lowercase-name,
/// value)` pairs, reading only the header block (up to the blank separator line).
pub fn unfold_headers(raw: &str) -> Vec<(String, String)> {
    let end = raw
        .find("\r\n\r\n")
        .or_else(|| raw.find("\n\n"))
        .unwrap_or(raw.len());
    let head = &raw[..end];
    let mut headers: Vec<(String, String)> = Vec::new();
    let mut name = String::new();
    let mut value = String::new();
    for line in head.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if (line.starts_with(' ') || line.starts_with('\t')) && !name.is_empty() {
            value.push(' ');
            value.push_str(line.trim());
        } else if let Some((n, v)) = line.split_once(':') {
            if !name.is_empty() {
                headers.push((name.to_ascii_lowercase(), value.trim().to_string()));
            }
            name = n.trim().to_string();
            value = v.trim().to_string();
        }
    }
    if !name.is_empty() {
        headers.push((name.to_ascii_lowercase(), value.trim().to_string()));
    }
    headers
}

/// Look up a header value by (already-lowercase) name.
pub fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(n, _)| n == name)
        .map(|(_, v)| v.as_str())
}

/// Extract the `<id>` tokens from a header value (Message-ID / References / …).
pub fn extract_message_ids(value: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut rest = value;
    while let Some(start) = rest.find('<') {
        if let Some(end) = rest[start + 1..].find('>') {
            let id = rest[start + 1..start + 1 + end].trim();
            if !id.is_empty() {
                ids.push(id.to_string());
            }
            rest = &rest[start + 1 + end + 1..];
        } else {
            break;
        }
    }
    ids
}

/// Resolve the thread ROOT id: the FIRST id in `References` (the thread root),
/// else `In-Reply-To`, else the message's own id (angle brackets stripped).
pub fn thread_root_email(
    own_id: &str,
    in_reply_to: Option<&str>,
    references: Option<&str>,
) -> String {
    if let Some(refs) = references {
        if let Some(first) = extract_message_ids(refs).into_iter().next() {
            return first;
        }
    }
    if let Some(irt) = in_reply_to {
        if let Some(first) = extract_message_ids(irt).into_iter().next() {
            return first;
        }
    }
    own_id
        .trim()
        .trim_matches(|c| c == '<' || c == '>')
        .to_string()
}

/// Build the `(conv_id, text)` pair for an email chunk. `conv_id` clusters a whole
/// thread (`email:<root>`); the text is a compact record for embedding.
pub fn message_chunk(r: &EmailRecord) -> (String, String) {
    let conv_id = format!("email:{}", r.thread_root);
    let mut text = String::from("Email");
    if !r.from.is_empty() {
        text.push_str(&format!(" — from {}", r.from));
    }
    if !r.date.is_empty() {
        text.push_str(&format!(" ({})", r.date));
    }
    text.push('\n');
    if !r.subject.is_empty() {
        text.push_str(&format!("Subject: {}\n", r.subject));
    }
    text.push('\n');
    text.push_str(&r.body);
    (conv_id, text)
}

/// Truncate to at most `max` chars on a char boundary.
fn clamp(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gmail_authorize_url_carries_pkce_and_scope() {
        let url = build_gmail_authorize_url("cid.apps.googleusercontent.com", 49732, "st8", "chal");
        assert!(url.starts_with(GMAIL_AUTHORIZE));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A49732"));
        assert!(url.contains("code_challenge=chal"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("response_type=code"));
        // gmail.readonly scope, encoded.
        assert!(url.contains("scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly"));
        assert!(url.contains("state=st8"));
    }

    #[test]
    fn unfold_headers_joins_continuations_and_stops_at_body() {
        let raw = "Subject: hello\r\n world\r\nFrom: a@b.com\r\n\r\nBody: not a header\r\n";
        let h = unfold_headers(raw);
        assert_eq!(header(&h, "subject"), Some("hello world"));
        assert_eq!(header(&h, "from"), Some("a@b.com"));
        // The body line must not be parsed as a header.
        assert_eq!(header(&h, "body"), None);
    }

    #[test]
    fn extract_message_ids_pulls_angle_tokens() {
        let refs = "<a@x> <b@y>\n  <c@z>";
        assert_eq!(extract_message_ids(refs), vec!["a@x", "b@y", "c@z"]);
        assert!(extract_message_ids("no ids here").is_empty());
    }

    #[test]
    fn thread_root_prefers_references_then_in_reply_to_then_self() {
        // References present -> its FIRST id is the root.
        assert_eq!(
            thread_root_email("<self@m>", Some("<parent@m>"), Some("<root@m> <mid@m>")),
            "root@m"
        );
        // No references -> In-Reply-To.
        assert_eq!(
            thread_root_email("<self@m>", Some("<parent@m>"), None),
            "parent@m"
        );
        // Neither -> own id, brackets stripped.
        assert_eq!(thread_root_email("<self@m>", None, None), "self@m");
    }

    #[test]
    fn parse_rfc822_extracts_fields_and_threads_by_root() {
        let raw = concat!(
            "From: Ada <ada@example.com>\r\n",
            "Subject: Pipeline decision\r\n",
            "Date: Sat, 20 Nov 2021 14:22:01 -0800\r\n",
            "Message-ID: <reply@example.com>\r\n",
            "In-Reply-To: <parent@example.com>\r\n",
            "References: <root@example.com> <parent@example.com>\r\n",
            "Content-Type: text/plain; charset=utf-8\r\n",
            "\r\n",
            "We chose GRCh37 for continuity.\r\n",
        );
        let rec = parse_rfc822(raw.as_bytes());
        assert_eq!(rec.message_id, "reply@example.com");
        // Clusters on the References root, not its own id.
        assert_eq!(rec.thread_root, "root@example.com");
        assert_eq!(rec.subject, "Pipeline decision");
        assert!(rec.from.contains("ada@example.com"));
        assert!(rec.body.contains("GRCh37"));

        let (conv_id, text) = message_chunk(&rec);
        assert_eq!(conv_id, "email:root@example.com");
        assert!(text.contains("Subject: Pipeline decision"));
        assert!(text.contains("GRCh37"));
    }

    #[test]
    fn parse_gmail_message_uses_threadid_and_plain_body() {
        // Body "hola" -> base64url "aG9sYQ".
        let msg = serde_json::json!({
            "threadId": "T123",
            "snippet": "snippet fallback",
            "payload": {
                "mimeType": "multipart/alternative",
                "headers": [
                    {"name": "From", "value": "Bob <bob@x.com>"},
                    {"name": "Subject", "value": "Re: budget"},
                    {"name": "Message-ID", "value": "<m1@x.com>"}
                ],
                "parts": [
                    {"mimeType": "text/plain", "body": {"data": "aG9sYQ"}},
                    {"mimeType": "text/html", "body": {"data": "PGI+aGk8L2I+"}}
                ]
            }
        });
        let rec = parse_gmail_message(&msg);
        assert_eq!(rec.thread_root, "T123");
        assert_eq!(rec.message_id, "m1@x.com");
        assert_eq!(rec.subject, "Re: budget");
        assert_eq!(rec.body, "hola");
        let (conv_id, _) = message_chunk(&rec);
        assert_eq!(conv_id, "email:T123");
    }

    #[test]
    fn parse_gmail_message_falls_back_to_snippet() {
        let msg = serde_json::json!({
            "threadId": "T9",
            "snippet": "just a snippet",
            "payload": { "mimeType": "text/html", "headers": [] }
        });
        let rec = parse_gmail_message(&msg);
        assert_eq!(rec.body, "just a snippet");
    }
}

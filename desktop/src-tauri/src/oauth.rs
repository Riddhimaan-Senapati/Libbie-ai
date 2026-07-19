//! Shared OAuth plumbing for the loopback connectors (Slack + Gmail).
//!
//! Everything here is dependency-light and permissive:
//! * URL encoding / query parsing done by hand (no `url`/`percent-encoding` dep).
//! * PKCE (RFC 7636, S256) and CSRF `state` built on `ring` (already in the tree
//!   via rustls) for SHA-256 and a CSPRNG.
//! * A one-shot loopback listener (`tiny_http`) that catches the `?code&state`
//!   redirect, binding `127.0.0.1` only and validating `state` before accepting a
//!   code.

use std::time::Duration;

use ring::rand::SecureRandom;

// --------------------------------------------------------------------------- //
// URL encode / query parse
// --------------------------------------------------------------------------- //

/// Percent-encode a value for a query string / form body: everything that is not
/// an RFC 3986 unreserved character is escaped.
pub fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Extract and percent-decode a single query parameter from a request target such
/// as `/callback?code=abc&state=xyz`. Returns `None` when the key is absent.
pub fn query_param(target: &str, key: &str) -> Option<String> {
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if k == key {
            return Some(percent_decode(v));
        }
    }
    None
}

/// Decode `%XX` escapes and `+` (form space) in a query value.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(h), Some(l)) = (hi, lo) {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

// --------------------------------------------------------------------------- //
// base64url (no padding)
// --------------------------------------------------------------------------- //

const B64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Encode bytes as unpadded base64url (RFC 4648 §5).
pub fn base64url_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64URL[((n >> 18) & 63) as usize] as char);
        out.push(B64URL[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(B64URL[((n >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(B64URL[(n & 63) as usize] as char);
        }
    }
    out
}

/// Decode base64url (accepts URL-safe `-_` and standard `+/`, with or without
/// padding). Returns `None` on an invalid character. Used for Gmail body parts.
pub fn base64url_decode(input: &str) -> Option<Vec<u8>> {
    let mut bits: u32 = 0;
    let mut nbits = 0;
    let mut out: Vec<u8> = Vec::with_capacity(input.len() * 3 / 4 + 1);
    for c in input.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            b'\r' | b'\n' => continue,
            _ => return None,
        };
        bits = (bits << 6) | v as u32;
        nbits += 6;
        if nbits >= 8 {
            nbits -= 8;
            out.push((bits >> nbits) as u8);
        }
    }
    Some(out)
}

// --------------------------------------------------------------------------- //
// PKCE + CSRF state
// --------------------------------------------------------------------------- //

/// A PKCE code verifier and its S256 challenge.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

/// Generate a PKCE pair: a 43-char base64url verifier and its SHA-256 challenge.
pub fn pkce() -> Pkce {
    let verifier = base64url_encode(&random_bytes(32));
    let challenge = pkce_challenge(&verifier);
    Pkce {
        verifier,
        challenge,
    }
}

/// The S256 challenge for a verifier: `base64url(sha256(verifier))`.
pub fn pkce_challenge(verifier: &str) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, verifier.as_bytes());
    base64url_encode(digest.as_ref())
}

/// A random URL-safe CSRF `state` token.
pub fn random_state() -> String {
    base64url_encode(&random_bytes(16))
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    let rng = ring::rand::SystemRandom::new();
    // Falls back to a time-seeded value only if the OS RNG is unavailable, which
    // does not happen on supported desktop platforms.
    if rng.fill(&mut buf).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        for (i, b) in buf.iter_mut().enumerate() {
            *b = ((nanos >> (i % 16)) as u8) ^ (i as u8);
        }
    }
    buf
}

// --------------------------------------------------------------------------- //
// Loopback redirect catcher (tiny_http)
// --------------------------------------------------------------------------- //

/// Bind a one-shot loopback listener on an OS-chosen ephemeral port (Gmail: the
/// installed-app flow accepts any loopback port). Returns the server + its port.
pub fn bind_ephemeral() -> Result<(tiny_http::Server, u16), String> {
    let server = tiny_http::Server::http(("127.0.0.1", 0))
        .map_err(|e| format!("Could not bind a loopback port for the OAuth redirect: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| "Could not determine the loopback port.".to_string())?;
    Ok((server, port))
}

/// Bind a one-shot loopback listener on a FIXED port (Slack: the redirect URI —
/// and therefore the port — must match one registered on the app).
pub fn bind_fixed(port: u16) -> Result<tiny_http::Server, String> {
    tiny_http::Server::http(("127.0.0.1", port))
        .map_err(|e| format!("Could not bind loopback port {port} for the OAuth redirect: {e}"))
}

/// Block until the redirect arrives and return its `code`. Only a request whose
/// `state` matches `expected_state` is accepted (CSRF guard); anything else is
/// answered and ignored. Gives up after `timeout`. Runs synchronously — call from
/// `spawn_blocking`.
pub fn recv_oauth_code(
    server: tiny_http::Server,
    expected_state: &str,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err("Timed out waiting for authorization.".to_string());
        }
        match server.recv_timeout(remaining) {
            Ok(Some(request)) => {
                let target = request.url().to_string();
                if let Some(err) = query_param(&target, "error") {
                    let _ = request.respond(html_response(
                        "Authorization failed. You can close this tab.",
                    ));
                    return Err(format!("The provider returned an OAuth error: {err}"));
                }
                if query_param(&target, "state").as_deref() != Some(expected_state) {
                    let _ = request.respond(html_response("Unexpected request."));
                    continue;
                }
                match query_param(&target, "code") {
                    Some(c) if !c.is_empty() => {
                        let _ = request.respond(html_response(
                            "Connected. You can close this tab and return to Libbie.",
                        ));
                        return Ok(c);
                    }
                    _ => {
                        let _ = request.respond(html_response(
                            "No authorization code. You can close this tab.",
                        ));
                        return Err("The redirect carried no authorization code.".to_string());
                    }
                }
            }
            Ok(None) => return Err("Timed out waiting for authorization.".to_string()),
            Err(e) => return Err(format!("Loopback listener error: {e}")),
        }
    }
}

fn html_response(body: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>Libbie</title>\
         <body style=\"font-family:system-ui;padding:2rem\">{body}</body>"
    );
    let mut resp = tiny_http::Response::from_string(html);
    if let Ok(header) = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]) {
        resp.add_header(header);
    }
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencode_escapes_reserved() {
        assert_eq!(urlencode("a b/c:d"), "a%20b%2Fc%3Ad");
        assert_eq!(urlencode("Iv1.abc-DEF_09~"), "Iv1.abc-DEF_09~");
    }

    #[test]
    fn query_param_extracts_and_decodes() {
        let target = "/callback?code=abc%2F123&state=a+b";
        assert_eq!(query_param(target, "code").as_deref(), Some("abc/123"));
        assert_eq!(query_param(target, "state").as_deref(), Some("a b"));
        assert_eq!(query_param(target, "missing"), None);
        assert_eq!(query_param("/callback", "code"), None);
    }

    #[test]
    fn base64url_roundtrips_and_is_unpadded() {
        for input in [
            &b""[..],
            &b"f"[..],
            &b"fo"[..],
            &b"foo"[..],
            &b"foob"[..],
            &b"fooba"[..],
            &b"foobar"[..],
        ] {
            let enc = base64url_encode(input);
            assert!(!enc.contains('='), "must be unpadded: {enc}");
            assert_eq!(base64url_decode(&enc).as_deref(), Some(input));
        }
    }

    #[test]
    fn pkce_challenge_matches_rfc7636_appendix_b() {
        // RFC 7636 Appendix B test vector.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = pkce_challenge(verifier);
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn pkce_pair_is_wellformed() {
        let p = pkce();
        // 32 bytes -> 43 base64url chars, no padding.
        assert_eq!(p.verifier.len(), 43);
        assert!(!p.verifier.contains('='));
        assert_eq!(p.challenge, pkce_challenge(&p.verifier));
    }

    #[test]
    fn random_state_is_nonempty_and_urlsafe() {
        let s = random_state();
        assert!(!s.is_empty());
        assert!(s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
    }
}

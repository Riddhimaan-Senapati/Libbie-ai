//! GitHub integration — OAuth **device flow**, repo listing, and safe cloning.
//!
//! This lets a user index ANY repository they can access (public, private, or
//! org-owned) by authenticating through GitHub's device flow. The flow needs no
//! client secret and no embedded browser: the user is shown a short code to type
//! into `github.com/login/device` on any device.
//!
//! Dependency stance mirrors the rest of the app — PERMISSIVE ONLY. We talk to
//! the GitHub REST API directly with `reqwest` (already a dep) and clone with the
//! `git` binary via `tokio::process` (arg vector, no shell). We deliberately
//! avoid octocrab and git2/libgit2 (GPL-with-linking-exception).
//!
//! Security notes
//! --------------
//! * The OAuth token is NEVER written into `.git/config`, a clone URL, argv, or a
//!   temp file. Cloning uses a token-less URL plus an ephemeral `GIT_ASKPASS`
//!   helper; the token travels only through the child `git` process's environment
//!   and the helper file is removed after the clone.
//! * `GIT_TERMINAL_PROMPT=0` makes a missing/expired token fail fast instead of
//!   blocking on an interactive prompt.
//! * `full_name` (`owner/repo`) is validated against a strict allow-list before it
//!   is ever interpolated into a URL, and the clone destination is app-controlled
//!   — no path traversal.
//!
//! Operator setup
//! --------------
//! Register a GitHub OAuth App (Settings → Developer settings → OAuth Apps) with
//! device flow enabled and expose its client id via the `github_client_id` config
//! field or the `LIBBIE_GITHUB_CLIENT_ID` environment variable. Device flow needs
//! no client secret.
//!
//! SSO caveat
//! ----------
//! For orgs that enforce SAML SSO, a classic `repo` token must additionally be
//! authorized for that org (GitHub's "Configure SSO" on the token) or the org's
//! private repos will 404. Surface this to the user if their private org repos do
//! not appear.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

// --------------------------------------------------------------------------- //
// Endpoints / constants
// --------------------------------------------------------------------------- //
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const API_BASE: &str = "https://api.github.com";
const GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
const API_VERSION: &str = "2022-11-28";
const USER_AGENT: &str = "Libbie-desktop";

/// Environment variable the ephemeral GIT_ASKPASS helper reads the token from.
const ASKPASS_TOKEN_ENV: &str = "LIBBIE_GH_TOKEN";

// --------------------------------------------------------------------------- //
// Models
// --------------------------------------------------------------------------- //

/// Response of `POST /login/device/code`. `verification_uri` is where the user
/// types `user_code`; `interval` is the minimum seconds between token polls.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    #[serde(default = "default_expires_in")]
    pub expires_in: u64,
    #[serde(default = "default_interval")]
    pub interval: u64,
}

fn default_expires_in() -> u64 {
    900
}
fn default_interval() -> u64 {
    5
}

/// A repository the token can access. Extra API fields are ignored.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repo {
    pub full_name: String,
    #[serde(default)]
    pub private: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub default_branch: Option<String>,
}

// --------------------------------------------------------------------------- //
// Device flow
// --------------------------------------------------------------------------- //

/// Step 1 — ask GitHub for a device/user code pair. The classic `repo` scope
/// covers public, private, and org-owned private repositories.
pub async fn request_device_code(
    client: &reqwest::Client,
    client_id: &str,
) -> Result<DeviceCode, String> {
    let resp = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .form(&[("client_id", client_id), ("scope", "repo")])
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "GitHub returned {} requesting a device code.",
            resp.status()
        ));
    }
    resp.json::<DeviceCode>()
        .await
        .map_err(|e| format!("Unexpected device-code response from GitHub: {e}"))
}

/// Step 3 — poll `/login/oauth/access_token` until the user authorizes.
///
/// Honors the device-flow error protocol: keep polling on `authorization_pending`;
/// back off (+5s) on `slow_down`; and error on `expired_token` / `access_denied`.
/// Returns the raw access token string on success.
pub async fn poll_for_token(
    client: &reqwest::Client,
    client_id: &str,
    device_code: &str,
    interval: u64,
) -> Result<String, String> {
    let mut delay = interval.max(1);
    loop {
        // Wait first: GitHub requires at least `interval` seconds between polls.
        tokio::time::sleep(Duration::from_secs(delay)).await;

        let resp = client
            .post(ACCESS_TOKEN_URL)
            .header("Accept", "application/json")
            .header("User-Agent", USER_AGENT)
            .form(&[
                ("client_id", client_id),
                ("device_code", device_code),
                ("grant_type", GRANT_TYPE),
            ])
            .send()
            .await
            .map_err(|e| format!("Could not reach GitHub: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "GitHub returned {} while polling for the token.",
                resp.status()
            ));
        }
        let data: Value = resp
            .json()
            .await
            .map_err(|e| format!("Unexpected token response from GitHub: {e}"))?;

        if let Some(token) = data.get("access_token").and_then(|v| v.as_str()) {
            return Ok(token.to_string());
        }

        match data.get("error").and_then(|v| v.as_str()) {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                // GitHub may also send a new interval; take the larger.
                let suggested = data.get("interval").and_then(|v| v.as_u64()).unwrap_or(0);
                delay = (delay + 5).max(suggested);
                continue;
            }
            Some("expired_token") => {
                return Err(
                    "The device code expired before authorization. Start the connection again."
                        .to_string(),
                );
            }
            Some("access_denied") => {
                return Err("Authorization was denied.".to_string());
            }
            other => {
                return Err(format!(
                    "Unexpected GitHub device-flow response: {}",
                    other.unwrap_or("(no error field)")
                ));
            }
        }
    }
}

// --------------------------------------------------------------------------- //
// Repo listing (paginated)
// --------------------------------------------------------------------------- //

/// Extract the `rel="next"` URL from an RFC-5988 `Link` header, if any.
fn next_link(link_header: Option<&str>) -> Option<String> {
    let header = link_header?;
    for part in header.split(',') {
        if part.contains("rel=\"next\"") {
            let start = part.find('<')?;
            let rest = &part[start + 1..];
            let end = rest.find('>')?;
            return Some(rest[..end].to_string());
        }
    }
    None
}

/// List every repo the token can access, following `Link` pagination. Uses
/// `affiliation=owner,collaborator,organization_member` so personal, collaborated,
/// and org repos all appear.
pub async fn list_repos(client: &reqwest::Client, token: &str) -> Result<Vec<Repo>, String> {
    let mut url = format!(
        "{API_BASE}/user/repos?per_page=100&affiliation=owner,collaborator,organization_member"
    );
    let mut repos: Vec<Repo> = Vec::new();
    loop {
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .header("User-Agent", USER_AGENT)
            .send()
            .await
            .map_err(|e| format!("Could not reach GitHub: {e}"))?;
        if !resp.status().is_success() {
            let code = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "GitHub returned {code} listing repositories: {body}"
            ));
        }
        let next = next_link(resp.headers().get("link").and_then(|v| v.to_str().ok()));
        let page: Vec<Repo> = resp
            .json()
            .await
            .map_err(|e| format!("Unexpected repo-list response from GitHub: {e}"))?;
        repos.extend(page);
        match next {
            Some(n) => url = n,
            None => break,
        }
    }
    Ok(repos)
}

// --------------------------------------------------------------------------- //
// Safe clone
// --------------------------------------------------------------------------- //

/// `owner/repo` — letters, digits, dot, underscore, hyphen only (no traversal).
/// Equivalent to `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`, done without a regex dep.
pub fn valid_full_name(full_name: &str) -> bool {
    let mut parts = full_name.split('/');
    let (Some(owner), Some(repo), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    let seg_ok = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    };
    seg_ok(owner) && seg_ok(repo)
}

/// Write an ephemeral GIT_ASKPASS helper that echoes the token from the env.
///
/// The helper contains NO secret — it only reads `$LIBBIE_GH_TOKEN` at run time,
/// so the token never lands on disk. Returns the helper's path; the caller must
/// delete it after the clone.
fn write_askpass() -> Result<PathBuf, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir();

    #[cfg(windows)]
    {
        let path = dir.join(format!(
            "libbie_askpass_{}_{}.bat",
            std::process::id(),
            nanos
        ));
        // `echo(` (not `echo `) prints an empty line instead of "ECHO is on."
        // when the token env var is empty/unset.
        let script = format!("@echo off\r\necho(%{ASKPASS_TOKEN_ENV}%\r\n");
        std::fs::write(&path, script)
            .map_err(|e| format!("Could not write askpass helper: {e}"))?;
        Ok(path)
    }

    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(format!(
            "libbie_askpass_{}_{}.sh",
            std::process::id(),
            nanos
        ));
        let script = format!("#!/bin/sh\nprintf '%s\\n' \"${ASKPASS_TOKEN_ENV}\"\n");
        std::fs::write(&path, script)
            .map_err(|e| format!("Could not write askpass helper: {e}"))?;
        // 0700 — executable by owner only.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Could not chmod askpass helper: {e}"))?;
        Ok(path)
    }
}

/// Build the `git clone` argv and environment for a SAFE token clone.
///
/// The URL is token-less; the token travels only in the environment (read by the
/// askpass helper). Factored out so tests can assert the argv/env without a live
/// clone.
fn build_clone_command(
    full_name: &str,
    token: &str,
    dest: &Path,
    askpass: &Path,
) -> (Vec<String>, Vec<(String, String)>) {
    let url = format!("https://github.com/{full_name}.git");
    let args = vec![
        // Disable any ambient credential helper (e.g. Git Credential Manager on
        // Windows) so the askpass token is never persisted to disk / the OS store.
        "-c".to_string(),
        "credential.helper=".to_string(),
        "-c".to_string(),
        "credential.useHttpPath=false".to_string(),
        "clone".to_string(),
        "--depth".to_string(),
        "1".to_string(),
        "--single-branch".to_string(),
        // Skip blobs > 10 MB (fetched on demand if ever needed) to bound disk use
        // from a hostile/huge repo.
        "--filter=blob:limit=10m".to_string(),
        url,
        dest.to_string_lossy().into_owned(),
    ];
    let env = vec![
        (
            "GIT_ASKPASS".to_string(),
            askpass.to_string_lossy().into_owned(),
        ),
        ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
        (ASKPASS_TOKEN_ENV.to_string(), token.to_string()),
    ];
    (args, env)
}

/// Shallow-clone `owner/repo` into `dest` without leaking the token.
///
/// Validates `full_name`, writes an ephemeral GIT_ASKPASS helper, runs
/// `git clone --depth 1` with a token-less URL, and removes the helper afterwards.
pub async fn clone_repo(full_name: &str, token: &str, dest: &Path) -> Result<(), String> {
    if !valid_full_name(full_name) {
        return Err(format!(
            "Invalid repository {full_name:?}; expected 'owner/repo'."
        ));
    }
    let askpass = write_askpass()?;
    let result = run_clone(full_name, token, dest, &askpass).await;
    let _ = std::fs::remove_file(&askpass);
    result
}

async fn run_clone(
    full_name: &str,
    token: &str,
    dest: &Path,
    askpass: &Path,
) -> Result<(), String> {
    let (args, env) = build_clone_command(full_name, token, dest, askpass);

    let mut cmd = tokio::process::Command::new("git");
    cmd.args(&args);
    for (k, v) in &env {
        cmd.env(k, v);
    }
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());

    // Do not pop a console window on Windows.
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Could not run git (is it installed?): {e}"))?;
    if !output.status.success() {
        // git's stderr does not contain the token (askpass hides it).
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "git clone of {full_name} failed: {}",
            stderr.trim()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_name_accepts_valid_owner_repo() {
        for s in [
            "octocat/Hello-World",
            "a/b",
            "owner.name/repo_name",
            "Org-123/my.cool-repo",
        ] {
            assert!(valid_full_name(s), "{s} should be valid");
        }
    }

    #[test]
    fn full_name_rejects_traversal_and_malformed() {
        for s in [
            "owner",             // no slash
            "owner/",            // empty repo
            "/repo",             // empty owner
            "a/b/c",             // too many segments
            "../etc/passwd",     // traversal characters
            "owner/re po",       // space
            "owner/repo;rm -rf", // shell metachars
            "owner/repo?x=1",    // query
            "own er/repo",       // space in owner
            "",                  // empty
        ] {
            assert!(!valid_full_name(s), "{s} must be rejected");
        }
    }

    #[test]
    fn clone_command_keeps_token_out_of_argv_and_url() {
        let token = "gho_supersecrettoken123";
        let dest = Path::new("/tmp/libbie/clone-x");
        let askpass = Path::new("/tmp/libbie/askpass.sh");
        let (args, env) = build_clone_command("octocat/Hello-World", token, dest, askpass);

        // Shallow clone with an arg vector (no shell string).
        assert!(args.contains(&"clone".to_string()));
        assert!(args.windows(2).any(|w| w[0] == "--depth" && w[1] == "1"));
        // Ambient credential helpers disabled (token can't be persisted).
        assert!(args
            .windows(2)
            .any(|w| w[0] == "-c" && w[1] == "credential.helper="));
        assert!(args.iter().any(|a| a.starts_with("--filter=blob:limit=")));

        // The URL is token-less.
        assert!(args
            .iter()
            .any(|a| a == "https://github.com/octocat/Hello-World.git"));

        // The token appears in NO argv element.
        assert!(
            args.iter().all(|a| !a.contains(token)),
            "token must never appear in argv"
        );

        // The token is passed ONLY through the child environment.
        let token_env: Vec<_> = env.iter().filter(|(_, v)| v == token).collect();
        assert_eq!(token_env.len(), 1, "token must be in exactly one env var");
        assert_eq!(token_env[0].0, ASKPASS_TOKEN_ENV);

        // Askpass wiring is present and prompts are disabled.
        assert!(env
            .iter()
            .any(|(k, v)| k == "GIT_ASKPASS" && v == &askpass.to_string_lossy()));
        assert!(env
            .iter()
            .any(|(k, v)| k == "GIT_TERMINAL_PROMPT" && v == "0"));
    }

    #[test]
    fn next_link_extracts_rel_next() {
        let header = "<https://api.github.com/user/repos?page=2>; rel=\"next\", \
                      <https://api.github.com/user/repos?page=5>; rel=\"last\"";
        assert_eq!(
            next_link(Some(header)).as_deref(),
            Some("https://api.github.com/user/repos?page=2")
        );
        // Last page: no rel="next".
        let last = "<https://api.github.com/user/repos?page=1>; rel=\"prev\"";
        assert_eq!(next_link(Some(last)), None);
        assert_eq!(next_link(None), None);
    }
}

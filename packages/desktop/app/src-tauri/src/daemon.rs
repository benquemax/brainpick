//! First-run bootstrap (Chunk E, _plans/2026-07-09-algorithmic-brain-phase1.md):
//! detect a running brainpickd, or spawn one — "all magic in the service,
//! the GUI is a dumb UI layer" (_todo.md). Everything after this
//! module is a plain HTTP client talking to the control API; NO daemon logic
//! is reimplemented here.
//!
//! Path resolution mirrors packages/desktop/src/paths.ts EXACTLY (same env
//! vars, same XDG-style defaults) — this app and the daemon it spawns must
//! agree on where the config dir (and the token file inside it) lives, on
//! every platform the JS side currently supports.

use std::env;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::time::sleep;

const DEFAULT_DAEMON_PORT: u16 = 4748;
const HEALTH_POLL_INTERVAL_MS: u64 = 300;
const HEALTH_POLL_TIMEOUT_S: u64 = 20;

#[derive(Debug, Serialize, Clone)]
pub struct DaemonInfo {
    pub base_url: String,
    pub token: String,
}

#[derive(Debug, thiserror::Error)]
pub enum DaemonError {
    #[error("no daemon token at {0} — the daemon has never run here")]
    NoToken(PathBuf),
    #[error("could not locate brainpickd's cli.js (set BRAINPICK_DAEMON_CLI, or run `npm run build -w packages/desktop`)")]
    CliNotFound,
    #[error("spawning brainpickd failed: {0}")]
    SpawnFailed(std::io::Error),
    #[error("brainpickd did not answer /daemon/health within {0}s")]
    NeverHealthy(u64),
}

impl Serialize for DaemonError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

fn home_dir() -> PathBuf {
    env::var("HOME").map(PathBuf::from).unwrap_or_default()
}

/// Same precedence as paths.ts's configDir: explicit override > XDG > default.
fn config_dir() -> PathBuf {
    if let Ok(dir) = env::var("BRAINPICK_DAEMON_CONFIG_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    let base = env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".config"));
    base.join("brainpick")
}

fn daemon_host() -> String {
    env::var("BRAINPICK_DAEMON_HOST").unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn daemon_port() -> u16 {
    env::var("BRAINPICK_DAEMON_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_DAEMON_PORT)
}

fn base_url() -> String {
    format!("http://{}:{}", daemon_host(), daemon_port())
}

fn read_token() -> Option<String> {
    std::fs::read_to_string(config_dir().join("token"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

async fn probe_health(token: &str) -> bool {
    let client = match reqwest::Client::builder().timeout(Duration::from_secs(2)).build() {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get(format!("{}/daemon/health", base_url()))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Resolve the node binary to run the daemon with — same override the daemon
/// itself honors for spawning the ENGINE (BRAINPICK_NODE), reused here one
/// level up: whatever `node` this app runs the daemon's cli.js with.
fn resolve_node_binary(app: &AppHandle) -> String {
    if let Ok(node) = env::var("BRAINPICK_NODE") {
        if !node.is_empty() {
            return node;
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("node").join("bin").join("node");
        if bundled.is_file() {
            return bundled.to_string_lossy().into_owned();
        }
    }
    "node".to_string() // dev fallback — assumes a system Node on PATH
}

/// Resolve brainpickd's own cli.js — BRAINPICK_DAEMON_CLI override, else a
/// bundled resource (packaged builds), else the dev-time sibling build
/// (`cargo` bakes its own manifest dir in at compile time, so this only ever
/// resolves to a path valid on the machine that built the debug binary).
fn resolve_daemon_cli(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(cli) = env::var("BRAINPICK_DAEMON_CLI") {
        if !cli.is_empty() {
            return Some(PathBuf::from(cli));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("daemon").join("cli.js");
        if bundled.is_file() {
            return Some(bundled);
        }
    }
    if cfg!(debug_assertions) {
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("dist")
            .join("cli.js");
        if dev_path.is_file() {
            return Some(dev_path);
        }
    }
    None
}

fn spawn_daemon(app: &AppHandle) -> Result<(), DaemonError> {
    let cli = resolve_daemon_cli(app).ok_or(DaemonError::CliNotFound)?;
    let node = resolve_node_binary(app);
    Command::new(node)
        .arg(cli)
        .arg("start")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(DaemonError::SpawnFailed)?;
    Ok(())
}

/// Detect a reachable daemon, or spawn one and wait for it to answer.
/// Returns everything the frontend needs to talk to the control API itself
/// — this app never proxies daemon calls through Rust, it just gets them
/// started and hands over the address + token.
pub async fn ensure_daemon(app: &AppHandle) -> Result<DaemonInfo, DaemonError> {
    let token_path = config_dir().join("token");

    if let Some(token) = read_token() {
        if probe_health(&token).await {
            return Ok(DaemonInfo { base_url: base_url(), token });
        }
    }

    spawn_daemon(app)?;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(HEALTH_POLL_TIMEOUT_S);
    loop {
        sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS)).await;
        if let Some(token) = read_token() {
            if probe_health(&token).await {
                return Ok(DaemonInfo { base_url: base_url(), token });
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return match read_token() {
                Some(_) => Err(DaemonError::NeverHealthy(HEALTH_POLL_TIMEOUT_S)),
                None => Err(DaemonError::NoToken(token_path)),
            };
        }
    }
}

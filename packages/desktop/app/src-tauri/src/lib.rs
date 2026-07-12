//! brainpick — the desktop app. A thin client of brainpickd (_todo.md — "all magic in the brainpick service; the GUI is a dumb UI
//! layer using the backend"): this crate's only jobs are first-run bootstrap
//! (detect/spawn the daemon — the one thing that genuinely can't live in the
//! service) and a tray icon. Every other feature is the frontend calling the
//! daemon's control API directly.

mod daemon;
mod tray;

use daemon::{DaemonError, DaemonInfo};

/// The frontend's one bootstrap call: ensures a daemon is running (spawning
/// one if needed) and returns where to reach it. Safe to call again later —
/// e.g. after the daemon crashes — since it re-probes health every time.
#[tauri::command]
async fn daemon_info(app: tauri::AppHandle) -> Result<DaemonInfo, DaemonError> {
    daemon::ensure_daemon(&app).await
}

#[derive(serde::Serialize)]
struct ApiResponse {
    status: u16,
    body: String,
}

/// Every control-API call goes through Rust (tester-zero, 2026-07-12): the
/// packaged webview's cross-origin fetch (tauri:// scheme → http://127.0.0.1)
/// SENDS the request but never hands the response back to JS — the wizard's
/// adds landed seven times while the UI saw nothing. reqwest has no scheme/
/// CORS/CSP politics; the webview never talks to the network again. The
/// generous timeout covers a clone + first compile of a large brain.
#[tauri::command]
async fn api_call(
    app: tauri::AppHandle,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<ApiResponse, String> {
    let info = daemon::ensure_daemon(&app).await.map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{}{}", info.base_url, path);
    let mut request = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "DELETE" => client.delete(&url),
        other => return Err(format!("unsupported method: {other}")),
    };
    request = request.header("Authorization", format!("Bearer {}", info.token));
    if let Some(payload) = body {
        request = request.header("Content-Type", "application/json").body(payload);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| e.to_string())?;
    Ok(ApiResponse { status, body: text })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![daemon_info, api_call])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match daemon::ensure_daemon(&handle).await {
                    Ok(info) => {
                        if let Err(err) = tray::build(&handle, info) {
                            eprintln!("brainpick: tray icon failed to start: {err}");
                        }
                    }
                    Err(err) => eprintln!("brainpick: daemon bootstrap failed: {err}"),
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

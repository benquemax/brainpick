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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![daemon_info])
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

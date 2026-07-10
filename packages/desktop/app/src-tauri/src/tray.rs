//! The tray icon (Chunk E MVP scope): per-brain status at a glance, polled
//! from the control API — no daemon logic here either, just a summary of
//! what GET /daemon/brains already says.

use std::time::Duration;

use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use crate::daemon::DaemonInfo;

const POLL_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
struct BrainSummary {
    process_status: String,
}

#[derive(Debug, Deserialize)]
struct BrainsResponse {
    brains: Vec<BrainSummary>,
}

async fn fetch_summary(info: &DaemonInfo) -> Option<String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(3)).build().ok()?;
    let response = client
        .get(format!("{}/daemon/brains", info.base_url))
        .header("Authorization", format!("Bearer {}", info.token))
        .send()
        .await
        .ok()?;
    let body: BrainsResponse = response.json().await.ok()?;
    if body.brains.is_empty() {
        return Some("brainpick — no brains yet".to_string());
    }
    let running = body.brains.iter().filter(|b| b.process_status == "running").count();
    Some(format!("brainpick — {running}/{} brains running", body.brains.len()))
}

pub fn build(app: &AppHandle, info: DaemonInfo) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "Open brainpick", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    let tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().expect("no default window icon bundled"))
        .tooltip("brainpick")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if let Some(tooltip) = fetch_summary(&info).await {
                let _ = tray.set_tooltip(Some(tooltip.as_str()));
            }
            let _ = &app_handle; // kept alive for the life of this loop
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });

    Ok(())
}

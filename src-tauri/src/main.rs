use std::path::PathBuf;

use tauri::{Manager, RunEvent};
use wmux_tauri::{commands, IpcState};
use anyhow::Context;

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let assets_dir = manifest_dir.join("../web/dist");
            let config_path = tauri_config_path(&manifest_dir);

            let ipc_state = tauri::async_runtime::block_on(async {
                IpcState::new(config_path, assets_dir).await
            })
            .context("failed to initialize IPC state")?;

            app.manage(ipc_state);

            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Wmux")
            .inner_size(1000.0, 720.0)
            .min_inner_size(760.0, 520.0)
            .build()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::commands::stream_poc::stream_burst,
            crate::commands::connections::list_connections,
            crate::commands::connections::create_connection,
            crate::commands::connections::get_connection,
            crate::commands::connections::update_connection,
            crate::commands::connections::delete_connection,
            crate::commands::connections::connection_health,
            crate::commands::connections::list_connections_health,
            crate::commands::sessions::list_sessions,
            crate::commands::sessions::create_session,
            crate::commands::sessions::delete_session,
            crate::commands::sessions::rename_session,
            crate::commands::sessions::analyze_session,
            crate::commands::sessions::list_windows,
            crate::commands::sessions::create_window,
            crate::commands::sessions::delete_window,
            crate::commands::sessions::list_panes,
            crate::commands::sessions::split_pane,
            crate::commands::sessions::delete_pane,
            crate::commands::config_cmd::get_config,
            crate::commands::config_cmd::update_config,
            crate::commands::skills::list_skills,
            crate::commands::skills::create_skill,
            crate::commands::skills::get_skill,
            crate::commands::skills::update_skill,
            crate::commands::skills::delete_skill,
            crate::commands::projects::list_projects,
            crate::commands::projects::create_project,
            crate::commands::projects::get_project,
            crate::commands::projects::update_project,
            crate::commands::projects::delete_project,
            crate::commands::projects::launch_project,
            crate::commands::projects::sync_from_tmux,
            crate::commands::projects::generate_ai_html,
            crate::commands::logs::get_error_logs,
            crate::commands::logs::clear_error_logs,
            crate::commands::ai::list_ai_logs,
            crate::commands::ai::clear_ai_logs,
            crate::commands::ai::get_ai_stats,
            crate::commands::ai::cleanup_stale_window_events,
            crate::commands::voice_history::list_voice_history,
            crate::commands::voice_history::clear_voice_history,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Wmux Tauri app");

    app.run(|_app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. }) {
        }
    });
}

fn tauri_config_path(manifest_dir: &std::path::Path) -> PathBuf {
    if cfg!(debug_assertions) {
        let workspace_config = manifest_dir.join("../config.jsonc");
        if workspace_config.exists() {
            return workspace_config;
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let cwd_config = cwd.join("config.jsonc");
        if cwd_config.exists() {
            return cwd_config;
        }
    }

    if let Ok(fallback) = wmux_core::config::fallback_config_path() {
        if fallback.exists() {
            return fallback;
        }
        if let Ok(config_path) = ensure_config_exists(&fallback) {
            return config_path;
        }
    }

    PathBuf::from(wmux_core::config::default_config_path())
}

fn ensure_config_exists(default_path: &std::path::Path) -> std::io::Result<PathBuf> {
    if default_path.exists() {
        return Ok(default_path.to_path_buf());
    }

    if let Some(parent) = default_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let default_config = include_str!("../config.default.jsonc");
    std::fs::write(default_path, default_config)?;

    Ok(default_path.to_path_buf())
}
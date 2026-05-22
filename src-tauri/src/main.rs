use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tokio::task::JoinHandle;

struct BackendState {
    server_handle: Mutex<Option<JoinHandle<()>>>,
}

impl BackendState {
    fn new(server_handle: JoinHandle<()>) -> Self {
        Self {
            server_handle: Mutex::new(Some(server_handle)),
        }
    }

    fn stop(&self) {
        let Some(server_handle) = self
            .server_handle
            .lock()
            .ok()
            .and_then(|mut guard| guard.take())
        else {
            return;
        };

        server_handle.abort();
        tauri::async_runtime::block_on(async {
            let _ = server_handle.await;
        });
    }
}

fn main() {
    unsafe {
        std::env::set_var("LANG", "en_US.UTF-8");
        std::env::set_var("LC_ALL", "en_US.UTF-8");
    }
    let app = tauri::Builder::default()
        .setup(|app| {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let assets_dir = manifest_dir.join("../web/dist");
            let config_path = tauri_config_path(&manifest_dir);
            let (token, port, server_handle) = match tauri::async_runtime::block_on(
                wmux_core::app::start_in_process(assets_dir, config_path),
            ) {
                Ok(runtime) => runtime,
                Err(error) => {
                    eprintln!("{}", wmux_core::app::format_startup_error(&error));
                    return Err(error.into());
                }
            };
            app.manage(BackendState::new(server_handle));

            let initialization_script = format!(
                r#"window.__WMUX_RUNTIME__ = {{ baseUrl: "http://127.0.0.1:{port}", token: "{token}" }};"#,
            );
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Wmux")
            .inner_size(1000.0, 720.0)
            .min_inner_size(760.0, 520.0)
            .initialization_script(&initialization_script)
            .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Wmux Tauri app");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. }) {
            app_handle.state::<BackendState>().stop();
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

    wmux_core::config::fallback_config_path()
        .unwrap_or_else(|_| PathBuf::from(wmux_core::config::default_config_path()))
}

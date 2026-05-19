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
    let app = tauri::Builder::default()
        .setup(|app| {
            let assets_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../web/dist");
            let (token, port, server_handle) = tauri::async_runtime::block_on(
                wmux_core::app::start_in_process(assets_dir),
            )?;
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

use std::path::PathBuf;

use anyhow::{Context, Result};
use tokio::task::JoinHandle;

use crate::config::{Config, default_config_path};
use crate::state::AppState;

pub async fn start_in_process(assets_dir: PathBuf) -> Result<(String, u16, JoinHandle<()>)> {
    let token = random_token();
    let store = Config::load(default_config_path()).with_context(|| {
        format!("failed to load config from {}", default_config_path())
    })?;
    let mut config = store
        .snapshot()
        .context("failed to read config snapshot")?
        .expanded()
        .context("failed to expand config paths")?;
    config.server.bind = "127.0.0.1:0".to_string();
    config.auth.token = token.clone();
    config.validate_auth().context("invalid config")?;

    store
        .replace_in_memory(config)
        .context("failed to prepare runtime config")?;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .context("failed to bind in-process server to 127.0.0.1:0")?;
    let port = listener
        .local_addr()
        .context("failed to read in-process server port")?
        .port();
    let state = AppState::new(store, assets_dir);
    let app = crate::routes::router(state);

    let server_handle = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            tracing::error!(raw_error = %error, "in-process server failed");
        }
    });

    Ok((token, port, server_handle))
}

fn random_token() -> String {
    let bytes: [u8; 32] = rand::random();
    let mut token = String::with_capacity(64);
    for byte in bytes {
        token.push_str(&format!("{byte:02x}"));
    }
    token
}

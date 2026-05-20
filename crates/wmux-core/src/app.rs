use std::path::PathBuf;

use anyhow::{Context, Result};
use tokio::task::JoinHandle;

use crate::config::{Config, default_config_path};
use crate::state::AppState;

pub async fn start_in_process(assets_dir: PathBuf) -> Result<(String, u16, JoinHandle<()>)> {
    let token = random_token();
    let store = Config::load(default_config_path())
        .with_context(|| format!("failed to load config from {}", default_config_path()))?;
    let mut config = store
        .snapshot()
        .context("failed to read config snapshot")?
        .expanded()
        .context("failed to expand config paths")?;
    config.server.bind = "127.0.0.1:0".to_string();
    config.auth.token = token.clone();
    config.validate_auth().context("invalid config")?;

    let logging_handle =
        crate::logging::init_tracing(&config.logs).context("failed to initialize logging")?;

    config.validate_storage_path().context("invalid storage config")?;
    let config_path = store.path().context("failed to resolve config path")?;
    store
        .replace_in_memory(config)
        .context("failed to prepare runtime config")?;
    let mut state = AppState::with_storage(
        store.clone(),
        assets_dir,
        logging_handle,
        &config_path,
    )
    .await
    .context("failed to initialize SQLite storage")?;

    if let Some(pool) = &state.storage {
        let cleanup_holder = crate::storage::cleanup::spawn_cleanup_task(pool.clone());
        state.set_cleanup_handle(cleanup_holder);
    }

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .context("failed to bind in-process server to 127.0.0.1:0")?;
    let port = listener
        .local_addr()
        .context("failed to read in-process server port")?
        .port();
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

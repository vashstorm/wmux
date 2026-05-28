use std::path::PathBuf;

use anyhow::{Context, Result};
use tokio::task::JoinHandle;

use crate::config::{Config, Store};
use crate::state::AppState;

#[derive(Debug)]
pub struct StartupConfig {
    pub store: Store,
    pub config_path: PathBuf,
    pub config: Config,
}

pub fn load_startup_config(config_path: PathBuf) -> Result<StartupConfig> {
    let store = Config::load(&config_path)
        .with_context(|| format!("failed to load config from {}", config_path.display()))?;
    let loaded_config_path = store.path().with_context(|| {
        format!(
            "failed to resolve loaded config path requested as {}",
            config_path.display()
        )
    })?;
    let config = store
        .snapshot()
        .with_context(|| {
            format!(
                "failed to read config snapshot from {}",
                loaded_config_path.display()
            )
        })?
        .expanded()
        .with_context(|| {
            format!(
                "failed to expand paths in config {}",
                loaded_config_path.display()
            )
        })?;
    config
        .validate_auth()
        .with_context(|| format!("invalid auth config in {}", loaded_config_path.display()))?;
    config
        .validate_path()
        .with_context(|| format!("invalid path config in {}", loaded_config_path.display()))?;
    config
        .validate_voice()
        .with_context(|| format!("invalid voice config in {}", loaded_config_path.display()))?;

    Ok(StartupConfig {
        store,
        config_path: loaded_config_path,
        config,
    })
}

pub fn format_startup_error(error: &anyhow::Error) -> String {
    let mut lines = vec!["wmux startup failed".to_string()];
    for (index, cause) in error.chain().enumerate() {
        if index == 0 {
            lines.push(format!("error: {cause}"));
        } else {
            lines.push(format!("caused by: {cause}"));
        }
    }
    lines.join("\n")
}

pub async fn start_in_process(
    assets_dir: PathBuf,
    config_path: PathBuf,
) -> Result<(String, u16, JoinHandle<()>)> {
    let token = random_token();
    let startup = load_startup_config(config_path)?;
    let store = startup.store;
    let mut config = startup.config;
    let config_path = startup.config_path;

    config.server.bind = "127.0.0.1:0".to_string();
    config.auth.token = token.clone();
    config.validate_auth().context("invalid config")?;

    let logging_handle = crate::logging::init_tracing(&config.logs, &config.path, &config_path)
        .context("failed to initialize logging")?;

    store
        .replace_in_memory(config)
        .context("failed to prepare runtime config")?;
    let mut state = AppState::with_storage(store.clone(), assets_dir, logging_handle, &config_path)
        .await
        .context("failed to initialize SQLite storage")?;

    if let Some(pool) = state.storage.clone() {
        let cleanup_holder = crate::storage::cleanup::spawn_cleanup_task(pool.clone());
        state.set_cleanup_handle(cleanup_holder);
        let sync_holder = crate::storage::sync::spawn_sync_task(pool, store.clone());
        state.set_sync_handle(sync_holder);
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

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn startup_config_empty_file_uses_bootable_default() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        fs::write(&config_path, "").expect("write empty config");

        let startup = load_startup_config(config_path.clone()).expect("load startup config");

        assert_eq!(startup.config_path, config_path);
        assert_eq!(startup.config.path, ".");
        assert!(startup.config_path.exists());
    }

    #[test]
    fn startup_config_error_mentions_path_and_cause() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        fs::write(&config_path, r#"{"server":{"bind":"0.0.0.0:7331"}}"#).expect("write config");

        let error = load_startup_config(config_path.clone()).expect_err("auth should fail");
        let message = format_startup_error(&error);

        assert!(message.contains("wmux startup failed"));
        assert!(message.contains(&config_path.display().to_string()));
        assert!(message.contains("auth token is required for non-localhost bind address"));
    }
}

use std::path::PathBuf;

use anyhow::Context;
use wmux_core::state::AppState;

pub struct IpcState {
    pub app_state: AppState,
    pub config_path: PathBuf,
}

impl IpcState {
    pub async fn new(config_path: PathBuf, assets_dir: PathBuf) -> anyhow::Result<Self> {
        let startup = wmux_core::app::load_startup_config(config_path.clone())
            .context("failed to load config")?;
        let store = startup.store;
        let config = startup.config;
        let config_path = startup.config_path;

        let logging_handle = wmux_core::logging::init_tracing(&config.logs, &config.path, &config_path)
            .context("failed to initialize logging")?;

        let mut app_state = AppState::with_storage(store.clone(), assets_dir, logging_handle, &config_path)
            .await
            .context("failed to initialize SQLite storage")?;

        let skills_dir = config_path
            .parent()
            .map(|p| p.join("skills"))
            .unwrap_or_else(|| PathBuf::from("skills"));
        app_state.skills.load_from_dir(&skills_dir);

        if let Some(pool) = app_state.storage.clone() {
            let cleanup_holder = wmux_core::storage::cleanup::spawn_cleanup_task(pool.clone());
            app_state.set_cleanup_handle(cleanup_holder);
            let sync_holder = wmux_core::storage::sync::spawn_sync_task(pool, store);
            app_state.set_sync_handle(sync_holder);
        }

        Ok(Self { app_state, config_path })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[tokio::test]
    async fn ipc_state_constructs_from_config() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("web");

        fs::write(&config_path, "").expect("write empty config");
        fs::create_dir_all(&assets_dir).expect("create assets dir");

        let state = IpcState::new(config_path, assets_dir).await;
        assert!(state.is_ok(), "IpcState should construct from config: {:?}", state.err());
    }
}
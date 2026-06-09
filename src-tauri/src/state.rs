use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Context;
use tokio::sync::RwLock;
use wmux_core::state::AppState;

pub struct IpcState {
    pub app_state: AppState,
    pub config_path: PathBuf,
    pub terminal_sessions: TerminalSessions,
}

pub struct TerminalSessionHandle {
    pub session: wmux_core::session::Session,
    pub target_name: String,
    pub session_name: String,
}

pub struct TerminalSessions {
    pub handles: RwLock<HashMap<String, Arc<RwLock<Option<TerminalSessionHandle>>>>>,
}

impl TerminalSessions {
    pub fn new() -> Self {
        Self {
            handles: RwLock::new(HashMap::new()),
        }
    }

    pub fn make_key(
        target_name: &str,
        session: &str,
        pane: Option<&str>,
        connection_id: &str,
    ) -> String {
        match pane {
            Some(p) => format!("{}:{}:{}:{}", target_name, session, p, connection_id),
            None => format!("{}:{}:{}", target_name, session, connection_id),
        }
    }
}

impl Default for TerminalSessions {
    fn default() -> Self {
        Self::new()
    }
}

impl IpcState {
    pub async fn new(config_path: PathBuf, assets_dir: PathBuf) -> anyhow::Result<Self> {
        let startup = wmux_core::app::load_startup_config(config_path.clone())
            .context("failed to load config")?;
        let store = startup.store;
        let config = startup.config;
        let config_path = startup.config_path;

        let logging_handle =
            wmux_core::logging::init_tracing(&config.logs, &config.path, &config_path)
                .context("failed to initialize logging")?;

        let mut app_state =
            AppState::with_storage(store.clone(), assets_dir, logging_handle, &config_path)
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

        let analysis_holder = wmux_core::intelligence_task::spawn_analysis_task(app_state.clone());
        app_state.set_analysis_handle(analysis_holder);

        Ok(Self {
            app_state,
            config_path,
            terminal_sessions: TerminalSessions::new(),
        })
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
        assert!(
            state.is_ok(),
            "IpcState should construct from config: {:?}",
            state.err()
        );
    }
}

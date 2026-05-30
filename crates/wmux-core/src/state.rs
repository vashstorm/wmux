use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::Result;
use sqlx::SqlitePool;
use tokio::task::JoinHandle;

use wmux_core::config::{ConnectionConfig, Store};
use wmux_core::skills::OmniSkillDef;
use wmux_core::intelligence::IntelligenceStore;
use wmux_core::logging::LoggingHandle;
use wmux_core::session::SessionManager;

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub connections: RuntimeConnections,
    pub sessions: SessionManager,
    pub intelligence: IntelligenceStore,
    pub assets_dir: PathBuf,
    pub logging_handle: LoggingHandle,
    pub storage: Option<SqlitePool>,
    pub cleanup_handle: Option<Arc<Mutex<Option<JoinHandle<()>>>>>,
    pub sync_handle: Option<Arc<Mutex<Option<JoinHandle<()>>>>>,
    pub skills: Vec<OmniSkillDef>,
}

impl AppState {
    pub fn new(store: Store, assets_dir: PathBuf, logging_handle: LoggingHandle) -> Self {
        let connections = store
            .snapshot()
            .map(|config| RuntimeConnections::from_vec(config.connections))
            .unwrap_or_default();
        Self {
            store,
            connections,
            sessions: SessionManager::new(),
            intelligence: IntelligenceStore::default(),
            assets_dir,
            logging_handle,
            storage: None,
            cleanup_handle: None,
            sync_handle: None,
            skills: Vec::new(),
        }
    }

    pub async fn with_storage(
        store: Store,
        assets_dir: PathBuf,
        logging_handle: LoggingHandle,
        config_path: &Path,
    ) -> Result<Self> {
        let config = store
            .snapshot()
            .map_err(|e| anyhow::anyhow!("failed to read config snapshot: {}", e))?;
        config.validate_path()?;

        let resolved_path = wmux_core::config::resolve_storage_path(&config.path, config_path)?;

        let pool = wmux_core::storage::db::create_pool(&resolved_path).await?;
        wmux_core::storage::db::run_migrations(&pool).await?;

        let connections = RuntimeConnections::from_vec(config.connections);

        Ok(Self {
            store,
            connections,
            sessions: SessionManager::new(),
            intelligence: IntelligenceStore::default(),
            assets_dir,
            logging_handle,
            storage: Some(pool),
            cleanup_handle: None,
            sync_handle: None,
            skills: Vec::new(),
        })
    }

    pub fn set_cleanup_handle(&mut self, handle: Arc<Mutex<Option<JoinHandle<()>>>>) {
        self.cleanup_handle = Some(handle);
    }

    pub fn set_sync_handle(&mut self, handle: Arc<Mutex<Option<JoinHandle<()>>>>) {
        self.sync_handle = Some(handle);
    }
}

#[derive(Debug, Clone, Default)]
pub struct RuntimeConnections {
    inner: Arc<Mutex<Vec<ConnectionConfig>>>,
}

impl RuntimeConnections {
    pub fn from_vec(connections: Vec<ConnectionConfig>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(connections)),
        }
    }

    pub fn list(&self) -> Vec<ConnectionConfig> {
        self.inner
            .lock()
            .map(|connections| connections.clone())
            .unwrap_or_default()
    }

    pub fn create(&self, connection: ConnectionConfig) {
        if let Ok(mut connections) = self.inner.lock() {
            connections.push(connection);
        }
    }

    pub fn find(&self, target_name: &str) -> Option<ConnectionConfig> {
        let connections = self.inner.lock().ok()?;
        connections
            .iter()
            .find(|connection| connection.id == target_name)
            .cloned()
    }

    pub fn replace(&self, target_name: &str, next: ConnectionConfig) -> Option<ConnectionConfig> {
        let mut connections = self.inner.lock().ok()?;
        let existing = connections
            .iter_mut()
            .find(|connection| connection.id == target_name)?;
        *existing = next.clone();
        Some(next)
    }

    pub fn delete(&self, target_name: &str) -> Option<ConnectionConfig> {
        let mut connections = self.inner.lock().ok()?;
        let index = connections
            .iter()
            .position(|connection| connection.id == target_name)?;
        Some(connections.remove(index))
    }

    pub fn replace_all(&self, connections: Vec<ConnectionConfig>) {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = connections;
        }
    }
}

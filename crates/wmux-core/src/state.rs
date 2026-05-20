use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use wmux_core::config::{ConnectionConfig, Store};
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
        }
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
        self.inner.lock().map(|connections| connections.clone()).unwrap_or_default()
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

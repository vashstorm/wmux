use std::path::PathBuf;

use wmux_core::config::Store;
use wmux_core::intelligence::IntelligenceStore;
use wmux_core::logging::LoggingHandle;
use wmux_core::session::SessionManager;

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub sessions: SessionManager,
    pub intelligence: IntelligenceStore,
    pub assets_dir: PathBuf,
    pub logging_handle: LoggingHandle,
}

impl AppState {
    pub fn new(store: Store, assets_dir: PathBuf, logging_handle: LoggingHandle) -> Self {
        Self {
            store,
            sessions: SessionManager::new(),
            intelligence: IntelligenceStore::default(),
            assets_dir,
            logging_handle,
        }
    }
}

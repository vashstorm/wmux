use std::sync::{Arc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{Duration, MissedTickBehavior, interval};

use crate::intelligence;
use crate::services::sessions;
use crate::state::AppState;
use crate::tmux::Adapter;

const DEFAULT_ANALYSIS_INTERVAL_SECS: u64 = 30;
const STARTUP_DELAY_SECS: u64 = 5;

/// Spawns a background task that periodically analyzes all active tmux sessions.
/// Uses `intelligence.min_session_interval_sec` from config as the tick interval.
/// Returns a shared handle holder for abort during shutdown.
pub fn spawn_analysis_task(app_state: AppState) -> Arc<Mutex<Option<JoinHandle<()>>>> {
    let handle_holder = Arc::new(Mutex::new(None::<JoinHandle<()>>));
    let holder_for_task = Arc::clone(&handle_holder);

    let join_handle = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;

        let initial_interval_secs = app_state
            .store
            .snapshot()
            .map(|c| c.intelligence.min_session_interval_sec as u64)
            .unwrap_or(DEFAULT_ANALYSIS_INTERVAL_SECS)
            .max(5);

        let mut ticker = interval(Duration::from_secs(initial_interval_secs));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

        loop {
            ticker.tick().await;

            let interval_secs = app_state
                .store
                .snapshot()
                .map(|c| c.intelligence.min_session_interval_sec as u64)
                .unwrap_or(DEFAULT_ANALYSIS_INTERVAL_SECS)
                .max(5);

            if interval_secs != initial_interval_secs {
                ticker = interval(Duration::from_secs(interval_secs));
                ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
            }

            run_analysis_once(&app_state).await;
        }
    });

    *holder_for_task
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(join_handle);
    handle_holder
}

async fn run_analysis_once(app_state: &AppState) {
    let config = match app_state.store.snapshot() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(raw_error = %e, "failed to read config in analysis task");
            return;
        }
    };

    if !config.intelligence.enabled {
        return;
    }

    if intelligence::active_provider(&config).is_none() {
        return;
    }

    let tmux_path = if config.tmux.path.is_empty() {
        "tmux"
    } else {
        &config.tmux.path
    };
    let adapter = Adapter::new(tmux_path);

    let sessions = match adapter.list_sessions().await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "failed to list sessions in analysis task");
            return;
        }
    };

    for session in sessions {
        let target_name = "local".to_string();
        let session_name = session.name.clone();

        tracing::debug!(session = %session_name, "analyzing session in background task");

        if let Err(e) = sessions::analyze_session(app_state, target_name, session_name).await {
            tracing::error!(error = %e, "failed to analyze session in background task");
        }
    }
}

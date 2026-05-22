use sqlx::SqlitePool;
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::task::JoinHandle;
use tokio::time::{Duration, MissedTickBehavior, interval};

use crate::config::Store;
use crate::storage::ProjectRepository;
use crate::tmux::Adapter;
use crate::project_runtime::snapshot_from_tmux;

const SYNC_INTERVAL_SECS: u64 = 5;
const STARTUP_DELAY_SECS: u64 = 2;

/// Spawns a background task that periodically synchronizes all projects with their active tmux sessions.
/// Returns a shared handle holder for abort during shutdown.
pub fn spawn_sync_task(pool: SqlitePool, store: Store) -> Arc<Mutex<Option<JoinHandle<()>>>> {
    let handle_holder = Arc::new(Mutex::new(None::<JoinHandle<()>>));
    let holder_for_task = Arc::clone(&handle_holder);

    let join_handle = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;

        let mut ticker = interval(Duration::from_secs(SYNC_INTERVAL_SECS));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

        loop {
            ticker.tick().await;
            run_sync_once(&pool, &store).await;
        }
    });

    *holder_for_task
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(join_handle);
    handle_holder
}

async fn run_sync_once(pool: &SqlitePool, store: &Store) {
    let repo = ProjectRepository::new(pool.clone());
    let projects = match repo.list().await {
        Ok(list) => list,
        Err(e) => {
            tracing::error!(raw_error = %e, "failed to list projects in sync task");
            return;
        }
    };

    let config = match store.snapshot() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(raw_error = %e, "failed to read config in sync task");
            return;
        }
    };

    let tmux_path = if config.tmux.path.is_empty() {
        "tmux"
    } else {
        &config.tmux.path
    };
    let adapter = Adapter::new(tmux_path);

    for project in projects {
        let session_name = if project.session_name.is_empty() {
            &project.name
        } else {
            &project.session_name
        };

        match adapter.has_session(session_name).await {
            Ok(true) => {
                // Session is running! Let's snapshot its layout and sync it
                match snapshot_from_tmux(&adapter, session_name).await {
                    Ok(snapshot) => {
                        let now_str = OffsetDateTime::now_utc()
                            .format(&Rfc3339)
                            .expect("RFC3339 format is infallible");
                        if let Err(e) = repo.update_snapshot(&project.id, &snapshot.layout_json, &snapshot.status, &now_str).await {
                            tracing::error!(project_id = %project.id, error = %e, "failed to update project snapshot in sync task");
                        }
                    }
                    Err(e) => {
                        tracing::error!(project_id = %project.id, session_name = %session_name, error = %e, "failed to snapshot session in sync task");
                    }
                }
            }
            Ok(false) => {
                // Session is stopped! If it was previously running/synced, update to stopped.
                if project.status != "stopped" {
                    let now_str = OffsetDateTime::now_utc()
                        .format(&Rfc3339)
                        .expect("RFC3339 format is infallible");
                    if let Err(e) = repo.update_snapshot(&project.id, &project.layout_json, "stopped", &now_str).await {
                        tracing::error!(project_id = %project.id, error = %e, "failed to update project status to stopped in sync task");
                    } else {
                        tracing::info!(project_id = %project.id, session_name = %session_name, "project status updated to stopped in sync task");
                    }
                }
            }
            Err(e) => {
                tracing::error!(session_name = %session_name, error = %e, "failed to check if tmux session exists in sync task");
            }
        }
    }
}

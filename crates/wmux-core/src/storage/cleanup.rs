use sqlx::SqlitePool;
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::task::JoinHandle;
use tokio::time::{Duration, MissedTickBehavior, interval};

const CLEANUP_INTERVAL_SECS: u64 = 24 * 60 * 60;
const STARTUP_DELAY_SECS: u64 = 5;
const RETENTION_DAYS: i64 = 31;

/// Returns the cutoff timestamp: now_utc - 31 days, formatted as RFC3339.
pub fn cutoff_31_days_ago() -> String {
    let cutoff = OffsetDateTime::now_utc() - time::Duration::days(RETENTION_DAYS);
    cutoff
        .format(&Rfc3339)
        .expect("RFC3339 format is infallible")
}

/// Spawns a cleanup task that runs once after a short startup delay, then every 24 hours.
/// Returns a shared handle holder for abort during shutdown.
pub fn spawn_cleanup_task(pool: SqlitePool) -> Arc<Mutex<Option<JoinHandle<()>>>> {
    let handle_holder = Arc::new(Mutex::new(None::<JoinHandle<()>>));
    let holder_for_task = Arc::clone(&handle_holder);

    let join_handle = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;
        run_cleanup_once(&pool).await;

        let mut ticker = interval(Duration::from_secs(CLEANUP_INTERVAL_SECS));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

        loop {
            ticker.tick().await;
            run_cleanup_once(&pool).await;
        }
    });

    *holder_for_task
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(join_handle);
    handle_holder
}

async fn run_cleanup_once(pool: &SqlitePool) {
    let cutoff = cutoff_31_days_ago();

    match crate::storage::AiUsageRepository::new(pool.clone())
        .delete_expired(&cutoff)
        .await
    {
        Ok(count) if count > 0 => {
            tracing::info!(count, cutoff = %cutoff, "deleted expired AI usage events");
        }
        Ok(_) => {}
        Err(err) => {
            tracing::error!(raw_error = %err, "failed to delete expired AI usage events");
        }
    }

    match crate::storage::AiLogRepository::new(pool.clone())
        .delete_expired(&cutoff)
        .await
    {
        Ok(count) if count > 0 => {
            tracing::info!(count, cutoff = %cutoff, "deleted expired AI logs");
        }
        Ok(_) => {}
        Err(err) => {
            tracing::error!(raw_error = %err, "failed to delete expired AI logs");
        }
    }

    match crate::storage::OmniHistoryRepository::new(pool.clone())
        .delete_expired(&cutoff)
        .await
    {
        Ok(count) if count > 0 => {
            tracing::info!(count, cutoff = %cutoff, "deleted expired voice history");
        }
        Ok(_) => {}
        Err(err) => {
            tracing::error!(raw_error = %err, "failed to delete expired voice history");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cutoff_31_days_ago_produces_valid_rfc3339() {
        let cutoff = cutoff_31_days_ago();
        OffsetDateTime::parse(&cutoff, &Rfc3339).expect("should parse as RFC3339");
    }

    #[tokio::test]
    async fn cleanup_task_aborts_cleanly() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");
        let pool = crate::storage::db::create_pool(&db_path)
            .await
            .expect("create pool");
        crate::storage::db::run_migrations(&pool)
            .await
            .expect("migrations");

        let holder = spawn_cleanup_task(pool.clone());

        // Abort the task immediately
        if let Some(handle) = holder
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            handle.abort();
            let _ = handle.await;
        }
    }
}

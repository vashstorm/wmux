pub mod ai_usage;
pub mod cleanup;
pub mod db;
pub mod models;
pub mod projects;

pub use crate::config::StorageConfig;

pub use ai_usage::AiUsageRepository;
pub use models::*;
pub use projects::{ProjectRepoError, ProjectRepository};

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn storage_tables_exist_after_migration() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");

        let pool = db::create_pool(&db_path).await.expect("create pool");
        db::run_migrations(&pool).await.expect("run migrations");

        let projects_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='projects'"
        )
        .fetch_one(&pool)
        .await
        .expect("count projects");

        let events_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ai_usage_events'"
        )
        .fetch_one(&pool)
        .await
        .expect("count events");

        assert_eq!(projects_count, 1);
        assert_eq!(events_count, 1);
    }
}
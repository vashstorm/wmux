use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};

pub async fn create_pool(path: &Path) -> Result<sqlx::SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true);

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .context("failed to create SQLite pool")
}

pub async fn run_migrations(pool: &sqlx::SqlitePool) -> Result<()> {
    let mut tx = pool.begin().await.context("failed to begin transaction")?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL UNIQUE,
            path TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_usage_events (
            id TEXT PRIMARY KEY NOT NULL,
            project_id TEXT,
            provider TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            target_name TEXT NOT NULL DEFAULT '',
            session_name TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'success',
            duration_ms INTEGER NOT NULL DEFAULT 0,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            total_tokens INTEGER,
            estimated_cost REAL,
            error_message TEXT,
            window_number INTEGER,
            response_json TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created_at ON ai_usage_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_ai_usage_events_project_created ON ai_usage_events(project_id, created_at);
        "#,
    )
    .execute(&mut *tx)
    .await
    .context("failed to execute migration SQL")?;

    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM pragma_table_info('ai_usage_events')"
    )
    .fetch_all(&mut *tx)
    .await
    .context("check ai_usage_events columns")?;

    if !columns.contains(&"window_number".to_string()) {
        sqlx::query("ALTER TABLE ai_usage_events ADD COLUMN window_number INTEGER")
            .execute(&mut *tx)
            .await
            .context("add window_number column")?;
    }
    if !columns.contains(&"response_json".to_string()) {
        sqlx::query("ALTER TABLE ai_usage_events ADD COLUMN response_json TEXT")
            .execute(&mut *tx)
            .await
            .context("add response_json column")?;
    }

    tx.commit().await.context("failed to commit migration")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn db_create_pool_and_migrations_creates_tables() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");

        let pool = create_pool(&db_path).await.expect("create pool");
        run_migrations(&pool).await.expect("run migrations");

        let projects_exist: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects')"
        )
        .fetch_one(&pool)
        .await
        .expect("check projects table");

        let events_exist: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_usage_events')"
        )
        .fetch_one(&pool)
        .await
        .expect("check ai_usage_events table");

        assert!(projects_exist, "projects table should exist");
        assert!(events_exist, "ai_usage_events table should exist");
    }

    #[tokio::test]
    async fn db_migrations_tables_have_correct_columns() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");

        let pool = create_pool(&db_path).await.expect("create pool");
        run_migrations(&pool).await.expect("run migrations");

        let projects_columns: Vec<(String, String)> = sqlx::query_as(
            "SELECT name, type FROM pragma_table_info('projects') ORDER BY cid"
        )
        .fetch_all(&pool)
        .await
        .expect("get projects columns");

        assert_eq!(projects_columns.len(), 6);
        assert_eq!(projects_columns[0].0, "id");
        assert_eq!(projects_columns[0].1, "TEXT");
        assert_eq!(projects_columns[1].0, "name");
        assert_eq!(projects_columns[1].1, "TEXT");
        assert_eq!(projects_columns[2].0, "path");
        assert_eq!(projects_columns[2].1, "TEXT");
        assert_eq!(projects_columns[3].0, "description");
        assert_eq!(projects_columns[3].1, "TEXT");
        assert_eq!(projects_columns[4].0, "created_at");
        assert_eq!(projects_columns[4].1, "TEXT");
        assert_eq!(projects_columns[5].0, "updated_at");
        assert_eq!(projects_columns[5].1, "TEXT");

        let events_columns: Vec<(String, String)> = sqlx::query_as(
            "SELECT name, type FROM pragma_table_info('ai_usage_events') ORDER BY cid"
        )
        .fetch_all(&pool)
        .await
        .expect("get ai_usage_events columns");

        assert_eq!(events_columns.len(), 16);
        assert_eq!(events_columns[0].0, "id");
        assert_eq!(events_columns[0].1, "TEXT");
        assert_eq!(events_columns[1].0, "project_id");
        assert_eq!(events_columns[1].1, "TEXT");
        assert_eq!(events_columns[2].0, "provider");
        assert_eq!(events_columns[2].1, "TEXT");
        assert_eq!(events_columns[3].0, "model");
        assert_eq!(events_columns[3].1, "TEXT");
        assert_eq!(events_columns[4].0, "target_name");
        assert_eq!(events_columns[4].1, "TEXT");
        assert_eq!(events_columns[5].0, "session_name");
        assert_eq!(events_columns[5].1, "TEXT");
        assert_eq!(events_columns[6].0, "status");
        assert_eq!(events_columns[6].1, "TEXT");
        assert_eq!(events_columns[7].0, "duration_ms");
        assert_eq!(events_columns[7].1, "INTEGER");
        assert_eq!(events_columns[8].0, "prompt_tokens");
        assert_eq!(events_columns[8].1, "INTEGER");
        assert_eq!(events_columns[9].0, "completion_tokens");
        assert_eq!(events_columns[9].1, "INTEGER");
        assert_eq!(events_columns[10].0, "total_tokens");
        assert_eq!(events_columns[10].1, "INTEGER");
        assert_eq!(events_columns[11].0, "estimated_cost");
        assert_eq!(events_columns[11].1, "REAL");
        assert_eq!(events_columns[12].0, "error_message");
        assert_eq!(events_columns[12].1, "TEXT");
        assert_eq!(events_columns[13].0, "window_number");
        assert_eq!(events_columns[13].1, "INTEGER");
        assert_eq!(events_columns[14].0, "response_json");
        assert_eq!(events_columns[14].1, "TEXT");
        assert_eq!(events_columns[15].0, "created_at");
        assert_eq!(events_columns[15].1, "TEXT");
    }
}
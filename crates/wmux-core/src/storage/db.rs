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

        CREATE TABLE IF NOT EXISTS voice_conversation_messages (
            id TEXT PRIMARY KEY NOT NULL,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            kind TEXT NOT NULL,
            text TEXT NOT NULL,
            event_json TEXT,
            target_name TEXT,
            session_name TEXT,
            window_name TEXT,
            pane_index INTEGER,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_voice_history_conv_created ON voice_conversation_messages(conversation_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_voice_history_created ON voice_conversation_messages(created_at);

        CREATE TABLE IF NOT EXISTS ai_logs (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            event_kind TEXT NOT NULL,
            model TEXT NOT NULL,
            status TEXT NOT NULL,
            prompt_text TEXT,
            tool_name TEXT,
            tool_call_id TEXT,
            tool_arguments_json TEXT,
            tool_result_json TEXT,
            metrics_json TEXT NOT NULL DEFAULT '{}',
            duration_ms INTEGER,
            raw_event_json TEXT NOT NULL DEFAULT '{}',
            error_message TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at ON ai_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_logs_conversation_created ON ai_logs(conversation_id, created_at DESC);
        "#,
    )
    .execute(&mut *tx)
    .await
    .context("failed to execute migration SQL")?;

    let columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('ai_usage_events')")
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

    // Add new columns to projects table
    let projects_columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('projects')")
            .fetch_all(&mut *tx)
            .await
            .context("check projects columns")?;

    if !projects_columns.contains(&"session_name".to_string()) {
        sqlx::query("ALTER TABLE projects ADD COLUMN session_name TEXT NOT NULL DEFAULT ''")
            .execute(&mut *tx)
            .await
            .context("add session_name column")?;
    }
    if !projects_columns.contains(&"status".to_string()) {
        sqlx::query("ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'stopped'")
            .execute(&mut *tx)
            .await
            .context("add status column")?;
    }
    if !projects_columns.contains(&"workdir".to_string()) {
        sqlx::query("ALTER TABLE projects ADD COLUMN workdir TEXT NOT NULL DEFAULT ''")
            .execute(&mut *tx)
            .await
            .context("add workdir column")?;
    }
    if !projects_columns.contains(&"layout_json".to_string()) {
        sqlx::query(r#"ALTER TABLE projects ADD COLUMN layout_json TEXT NOT NULL DEFAULT '{"schemaVersion":1,"windows":[]}'"#)
            .execute(&mut *tx)
            .await
            .context("add layout_json column")?;
    }
    if !projects_columns.contains(&"details_json".to_string()) {
        sqlx::query("ALTER TABLE projects ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'")
            .execute(&mut *tx)
            .await
            .context("add details_json column")?;
    }
    if !projects_columns.contains(&"progress_json".to_string()) {
        sqlx::query("ALTER TABLE projects ADD COLUMN progress_json TEXT NOT NULL DEFAULT '{}'")
            .execute(&mut *tx)
            .await
            .context("add progress_json column")?;
    }
    if !projects_columns.contains(&"ai_html".to_string()) {
        sqlx::query("ALTER TABLE projects ADD COLUMN ai_html TEXT NOT NULL DEFAULT ''")
            .execute(&mut *tx)
            .await
            .context("add ai_html column")?;
    }
    if !projects_columns.contains(&"ai_status".to_string()) {
        sqlx::query("ALTER TABLE projects ADD COLUMN ai_status TEXT NOT NULL DEFAULT 'idle'")
            .execute(&mut *tx)
            .await
            .context("add ai_status column")?;
    }
    if !projects_columns.contains(&"ai_error".to_string()) {
        sqlx::query("ALTER TABLE projects ADD COLUMN ai_error TEXT NOT NULL DEFAULT ''")
            .execute(&mut *tx)
            .await
            .context("add ai_error column")?;
    }
    if !projects_columns.contains(&"last_synced_at".to_string()) {
        sqlx::query("ALTER TABLE projects ADD COLUMN last_synced_at TEXT")
            .execute(&mut *tx)
            .await
            .context("add last_synced_at column")?;
    }
    if !projects_columns.contains(&"schema_version".to_string()) {
        sqlx::query("ALTER TABLE projects ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1")
            .execute(&mut *tx)
            .await
            .context("add schema_version column")?;
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
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects')",
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

        let projects_columns: Vec<(String, String)> =
            sqlx::query_as("SELECT name, type FROM pragma_table_info('projects') ORDER BY cid")
                .fetch_all(&pool)
                .await
                .expect("get projects columns");

        assert_eq!(projects_columns.len(), 17);
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
        assert_eq!(projects_columns[6].0, "session_name");
        assert_eq!(projects_columns[6].1, "TEXT");
        assert_eq!(projects_columns[7].0, "status");
        assert_eq!(projects_columns[7].1, "TEXT");
        assert_eq!(projects_columns[8].0, "workdir");
        assert_eq!(projects_columns[8].1, "TEXT");
        assert_eq!(projects_columns[9].0, "layout_json");
        assert_eq!(projects_columns[9].1, "TEXT");
        assert_eq!(projects_columns[10].0, "details_json");
        assert_eq!(projects_columns[10].1, "TEXT");
        assert_eq!(projects_columns[11].0, "progress_json");
        assert_eq!(projects_columns[11].1, "TEXT");
        assert_eq!(projects_columns[12].0, "ai_html");
        assert_eq!(projects_columns[12].1, "TEXT");
        assert_eq!(projects_columns[13].0, "ai_status");
        assert_eq!(projects_columns[13].1, "TEXT");
        assert_eq!(projects_columns[14].0, "ai_error");
        assert_eq!(projects_columns[14].1, "TEXT");
        assert_eq!(projects_columns[15].0, "last_synced_at");
        assert_eq!(projects_columns[15].1, "TEXT");
        assert_eq!(projects_columns[16].0, "schema_version");
        assert_eq!(projects_columns[16].1, "INTEGER");

        let events_columns: Vec<(String, String)> = sqlx::query_as(
            "SELECT name, type FROM pragma_table_info('ai_usage_events') ORDER BY cid",
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

    #[tokio::test]
    async fn voice_history_migration_creates_table_and_indexes() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create pool");
        run_migrations(&pool).await.expect("run migrations");

        let columns: Vec<(String, String)> = sqlx::query_as(
            "SELECT name, type FROM pragma_table_info('voice_conversation_messages') ORDER BY cid",
        )
        .fetch_all(&pool)
        .await
        .expect("get voice history columns");

        assert_eq!(columns.len(), 11);
        assert_eq!(columns[0], ("id".to_string(), "TEXT".to_string()));
        assert_eq!(
            columns[1],
            ("conversation_id".to_string(), "TEXT".to_string())
        );
        assert_eq!(columns[2], ("role".to_string(), "TEXT".to_string()));
        assert_eq!(columns[3], ("kind".to_string(), "TEXT".to_string()));
        assert_eq!(columns[4], ("text".to_string(), "TEXT".to_string()));
        assert_eq!(columns[5], ("event_json".to_string(), "TEXT".to_string()));
        assert_eq!(columns[6], ("target_name".to_string(), "TEXT".to_string()));
        assert_eq!(columns[7], ("session_name".to_string(), "TEXT".to_string()));
        assert_eq!(columns[8], ("window_name".to_string(), "TEXT".to_string()));
        assert_eq!(
            columns[9],
            ("pane_index".to_string(), "INTEGER".to_string())
        );
        assert_eq!(columns[10], ("created_at".to_string(), "TEXT".to_string()));

        let indexes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='voice_conversation_messages' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .expect("get voice history indexes");

        assert!(indexes.contains(&"idx_voice_history_conv_created".to_string()));
        assert!(indexes.contains(&"idx_voice_history_created".to_string()));
    }
}

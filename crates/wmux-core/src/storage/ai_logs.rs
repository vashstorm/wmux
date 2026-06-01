use sqlx::SqlitePool;
use uuid::Uuid;

use crate::storage::models::{AiLogEntry, AiLogListResponse, NewAiLogEntry};

#[derive(Debug, thiserror::Error)]
pub enum AiLogRepoError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

pub struct AiLogRepository {
    pool: SqlitePool,
}

impl AiLogRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert(&self, entry: &NewAiLogEntry) -> Result<AiLogEntry, AiLogRepoError> {
        let id = entry
            .id
            .as_ref()
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let created_at = entry
            .created_at
            .as_ref()
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| now_utc());

        sqlx::query(
            "INSERT INTO ai_logs (id, conversation_id, event_kind, model, status, prompt_text, tool_name, tool_call_id, tool_arguments_json, tool_result_json, metrics_json, duration_ms, raw_event_json, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&entry.conversation_id)
        .bind(&entry.event_kind)
        .bind(&entry.model)
        .bind(&entry.status)
        .bind(&entry.prompt_text)
        .bind(&entry.tool_name)
        .bind(&entry.tool_call_id)
        .bind(&entry.tool_arguments_json)
        .bind(&entry.tool_result_json)
        .bind(&entry.metrics_json)
        .bind(entry.duration_ms)
        .bind(&entry.raw_event_json)
        .bind(&entry.error_message)
        .bind(&created_at)
        .execute(&self.pool)
        .await?;

        self.get_by_id(&id).await
    }

    pub async fn list(
        &self,
        limit: u32,
        before: Option<&str>,
    ) -> Result<AiLogListResponse, AiLogRepoError> {
        let clamped_limit = limit.clamp(1, 200);

        let rows = if let Some(before) = before {
            sqlx::query_as::<_, AiLogEntry>(
                "SELECT id, conversation_id, event_kind, model, status, prompt_text, tool_name, tool_call_id, tool_arguments_json, tool_result_json, metrics_json, duration_ms, raw_event_json, error_message, created_at FROM ai_logs WHERE created_at < ? ORDER BY created_at DESC LIMIT ?",
            )
            .bind(before)
            .bind(clamped_limit as i64)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, AiLogEntry>(
                "SELECT id, conversation_id, event_kind, model, status, prompt_text, tool_name, tool_call_id, tool_arguments_json, tool_result_json, metrics_json, duration_ms, raw_event_json, error_message, created_at FROM ai_logs ORDER BY created_at DESC LIMIT ?",
            )
            .bind(clamped_limit as i64)
            .fetch_all(&self.pool)
            .await?
        };

        let next_cursor = if rows.len() == clamped_limit as usize {
            rows.last().map(|r| r.created_at.clone())
        } else {
            None
        };

        Ok(AiLogListResponse {
            data: rows,
            next_cursor,
        })
    }

    pub async fn clear(&self) -> Result<(), AiLogRepoError> {
        sqlx::query("DELETE FROM ai_logs")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_tool_call_status(
        &self,
        conversation_id: &str,
        tool_call_id: &str,
        status: &str,
        duration_ms: Option<i64>,
        tool_result_json: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<(), AiLogRepoError> {
        sqlx::query(
            "UPDATE ai_logs SET status = ?, duration_ms = ?, tool_result_json = ?, error_message = ? WHERE conversation_id = ? AND tool_call_id = ? AND event_kind = 'tool_call'",
        )
        .bind(status)
        .bind(duration_ms)
        .bind(tool_result_json)
        .bind(error_message)
        .bind(conversation_id)
        .bind(tool_call_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn get_by_id(&self, id: &str) -> Result<AiLogEntry, AiLogRepoError> {
        let row = sqlx::query_as::<_, AiLogEntry>(
            "SELECT id, conversation_id, event_kind, model, status, prompt_text, tool_name, tool_call_id, tool_arguments_json, tool_result_json, metrics_json, duration_ms, raw_event_json, error_message, created_at FROM ai_logs WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }
}

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db;

    async fn setup_test_db() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create pool");
        db::run_migrations(&pool).await.expect("run migrations");
        pool
    }

    fn new_entry(conversation_id: &str, created_at: &str, event_kind: &str) -> NewAiLogEntry {
        NewAiLogEntry {
            id: None,
            conversation_id: conversation_id.to_string(),
            event_kind: event_kind.to_string(),
            model: "qwen-omni".to_string(),
            status: "success".to_string(),
            prompt_text: Some("test prompt".to_string()),
            tool_name: None,
            tool_call_id: None,
            tool_arguments_json: None,
            tool_result_json: None,
            metrics_json: "{}".to_string(),
            duration_ms: Some(100),
            raw_event_json: "{}".to_string(),
            error_message: None,
            created_at: Some(created_at.to_string()),
        }
    }

    #[tokio::test]
    async fn ai_log_repository_insert_and_list_returns_newest_first() {
        let pool = setup_test_db().await;
        let repo = AiLogRepository::new(pool);

        repo.insert(&new_entry("conv-a", "2026-05-28T10:00:00Z", "request"))
            .await
            .expect("insert first");
        repo.insert(&new_entry("conv-a", "2026-05-28T10:01:00Z", "response"))
            .await
            .expect("insert second");
        repo.insert(&new_entry("conv-b", "2026-05-28T10:02:00Z", "request"))
            .await
            .expect("insert other");

        let result = repo.list(50, None).await.expect("list logs");

        assert_eq!(result.data.len(), 3);
        assert_eq!(result.data[0].event_kind, "request");
        assert_eq!(result.data[0].conversation_id, "conv-b");
        assert_eq!(result.data[1].event_kind, "response");
        assert_eq!(result.data[1].conversation_id, "conv-a");
        assert!(uuid::Uuid::parse_str(&result.data[0].id).is_ok());
        assert!(result.next_cursor.is_none());
    }

    #[tokio::test]
    async fn ai_log_repository_limit_clamps_to_range() {
        let pool = setup_test_db().await;
        let repo = AiLogRepository::new(pool);

        for i in 0..205 {
            let created_at = format!("2026-05-28T10:{i:02}:00Z");
            repo.insert(&new_entry("conv-a", &created_at, "request"))
                .await
                .expect("insert log");
        }

        let result_min = repo.list(0, None).await.expect("list min clamp");
        assert_eq!(result_min.data.len(), 1);

        let result_max = repo.list(1000, None).await.expect("list max clamp");
        assert_eq!(result_max.data.len(), 200);
        assert!(result_max.next_cursor.is_some());
        assert_eq!(
            result_max.next_cursor.unwrap(),
            result_max.data.last().unwrap().created_at
        );
    }

    #[tokio::test]
    async fn ai_log_repository_before_cursor_filters_correctly() {
        let pool = setup_test_db().await;
        let repo = AiLogRepository::new(pool);

        for i in 0..15 {
            let created_at = format!("2026-05-28T10:{i:02}:00Z");
            repo.insert(&new_entry("conv-a", &created_at, "request"))
                .await
                .expect("insert log");
        }

        let result = repo
            .list(10, Some("2026-05-28T10:10:00Z"))
            .await
            .expect("list before cursor");

        assert_eq!(result.data.len(), 10);
        assert_eq!(result.data[0].created_at, "2026-05-28T10:09:00Z");
        assert_eq!(
            result.data.last().unwrap().created_at,
            "2026-05-28T10:00:00Z"
        );
    }

    #[tokio::test]
    async fn ai_log_repository_clear_deletes_all_logs() {
        let pool = setup_test_db().await;
        let repo = AiLogRepository::new(pool);

        repo.insert(&new_entry("conv-a", "2026-05-28T10:00:00Z", "request"))
            .await
            .expect("insert first");
        repo.insert(&new_entry("conv-b", "2026-05-28T10:01:00Z", "response"))
            .await
            .expect("insert second");

        repo.clear().await.expect("clear logs");

        let result = repo.list(50, None).await.expect("list after clear");
        assert!(result.data.is_empty());
    }

    #[tokio::test]
    async fn ai_log_repository_migration_is_idempotent() {
        let pool = setup_test_db().await;

        // Run migrations again
        db::run_migrations(&pool).await.expect("re-run migrations");

        // Verify table still exists and structure is correct
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ai_logs'",
        )
        .fetch_one(&pool)
        .await
        .expect("count ai_logs table");

        assert_eq!(count, 1);

        let repo = AiLogRepository::new(pool);
        repo.insert(&new_entry("conv-a", "2026-05-28T10:00:00Z", "request"))
            .await
            .expect("insert after re-migration");
    }

    #[tokio::test]
    async fn ai_log_repository_preserves_json_fields() {
        let pool = setup_test_db().await;
        let repo = AiLogRepository::new(pool);

        let entry = NewAiLogEntry {
            id: None,
            conversation_id: "conv-a".to_string(),
            event_kind: "tool_call".to_string(),
            model: "qwen-omni".to_string(),
            status: "success".to_string(),
            prompt_text: None,
            tool_name: Some("execute_command".to_string()),
            tool_call_id: Some("call-123".to_string()),
            tool_arguments_json: Some("{\"command\":\"ls\"}".to_string()),
            tool_result_json: Some("{\"output\":\"file1 file2\"}".to_string()),
            metrics_json: "{\"tokens\":150}".to_string(),
            duration_ms: Some(250),
            raw_event_json: "{\"raw\":\"data\"}".to_string(),
            error_message: None,
            created_at: Some("2026-05-28T10:00:00Z".to_string()),
        };

        let inserted = repo.insert(&entry).await.expect("insert json entry");

        assert_eq!(
            inserted.tool_arguments_json,
            Some("{\"command\":\"ls\"}".to_string())
        );
        assert_eq!(
            inserted.tool_result_json,
            Some("{\"output\":\"file1 file2\"}".to_string())
        );
        assert_eq!(inserted.metrics_json, "{\"tokens\":150}");
        assert_eq!(inserted.raw_event_json, "{\"raw\":\"data\"}");

        // Retrieve via list
        let result = repo.list(1, None).await.expect("list json entry");
        assert_eq!(result.data[0].metrics_json, "{\"tokens\":150}");
    }
}

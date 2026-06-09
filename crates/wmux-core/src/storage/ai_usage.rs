use anyhow::Result;
use sqlx::SqlitePool;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::config::random_hex;
use crate::storage::models::{AiUsageEvent, AiUsageSummary, NewAiUsageEvent};

fn now_utc() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("RFC3339 format is infallible")
}

pub struct AiUsageRepository {
    pool: SqlitePool,
}

impl AiUsageRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert(&self, event: &NewAiUsageEvent) -> Result<AiUsageEvent, sqlx::Error> {
        let id = random_hex(16);
        let now = now_utc();

        sqlx::query(
            "INSERT INTO ai_usage_events (id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, window_number, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&event.project_id)
        .bind(&event.provider)
        .bind(&event.model)
        .bind(&event.target_name)
        .bind(&event.session_name)
        .bind(&event.status)
        .bind(event.duration_ms)
        .bind(event.prompt_tokens)
        .bind(event.completion_tokens)
        .bind(event.total_tokens)
        .bind(event.estimated_cost)
        .bind(&event.error_message)
        .bind(event.window_number)
        .bind(&event.response_json)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        self.get_by_id(&id).await
    }

    async fn get_by_id(&self, id: &str) -> Result<AiUsageEvent, sqlx::Error> {
        sqlx::query_as::<_, AiUsageEvent>(
            "SELECT id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, window_number, response_json, created_at FROM ai_usage_events WHERE id = ?"
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn list(
        &self,
        limit: i64,
        project_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<AiUsageEvent>, sqlx::Error> {
        let clamped_limit = limit.min(200).max(1);

        match (project_id, status) {
            (Some(pid), Some(status)) => {
                sqlx::query_as::<_, AiUsageEvent>(
                    "SELECT id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, window_number, response_json, created_at FROM ai_usage_events WHERE project_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?"
                )
                .bind(pid)
                .bind(status)
                .bind(clamped_limit)
                .fetch_all(&self.pool)
                .await
            }
            (Some(pid), None) => {
                sqlx::query_as::<_, AiUsageEvent>(
                    "SELECT id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, window_number, response_json, created_at FROM ai_usage_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
                )
                .bind(pid)
                .bind(clamped_limit)
                .fetch_all(&self.pool)
                .await
            }
            (None, Some(status)) => {
                sqlx::query_as::<_, AiUsageEvent>(
                    "SELECT id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, window_number, response_json, created_at FROM ai_usage_events WHERE status = ? ORDER BY created_at DESC LIMIT ?"
                )
                .bind(status)
                .bind(clamped_limit)
                .fetch_all(&self.pool)
                .await
            }
            (None, None) => {
                sqlx::query_as::<_, AiUsageEvent>(
                    "SELECT id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, window_number, response_json, created_at FROM ai_usage_events ORDER BY created_at DESC LIMIT ?"
                )
                .bind(clamped_limit)
                .fetch_all(&self.pool)
                .await
            }
        }
    }

    pub async fn summary(&self, project_id: Option<&str>) -> Result<AiUsageSummary, sqlx::Error> {
        if let Some(pid) = project_id {
            sqlx::query_as::<_, AiUsageSummary>(
                r#"
                SELECT 
                    COUNT(*) as total_events,
                    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as total_success,
                    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as total_error,
                    SUM(duration_ms) as total_duration_ms,
                    COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
                    COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
                    COALESCE(SUM(total_tokens), 0) as total_tokens,
                    COALESCE(SUM(estimated_cost), 0.0) as total_estimated_cost
                FROM ai_usage_events
                WHERE project_id = ?
                "#,
            )
            .bind(pid)
            .fetch_one(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, AiUsageSummary>(
                r#"
                SELECT 
                    COUNT(*) as total_events,
                    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as total_success,
                    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as total_error,
                    SUM(duration_ms) as total_duration_ms,
                    COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
                    COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
                    COALESCE(SUM(total_tokens), 0) as total_tokens,
                    COALESCE(SUM(estimated_cost), 0.0) as total_estimated_cost
                FROM ai_usage_events
                "#,
            )
            .fetch_one(&self.pool)
            .await
        }
    }

    pub async fn delete_expired(&self, cutoff: &str) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM ai_usage_events WHERE created_at < ?")
            .bind(cutoff)
            .execute(&self.pool)
            .await?;

        Ok(result.rows_affected())
    }

    pub async fn delete_stale_window_events(
        &self,
        project_id: Option<&str>,
    ) -> Result<u64, sqlx::Error> {
        let cutoff = (OffsetDateTime::now_utc() - time::Duration::minutes(5))
            .format(&Rfc3339)
            .expect("RFC3339 format is infallible");

        let result = if let Some(pid) = project_id {
            sqlx::query("DELETE FROM ai_usage_events WHERE project_id = ? AND created_at < ?")
                .bind(pid)
                .bind(&cutoff)
                .execute(&self.pool)
                .await?
        } else {
            sqlx::query("DELETE FROM ai_usage_events WHERE created_at < ?")
                .bind(&cutoff)
                .execute(&self.pool)
                .await?
        };

        Ok(result.rows_affected())
    }
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

    fn new_window_event(
        target_name: &str,
        session_name: &str,
        window_number: i64,
        status: &str,
        response_json: Option<&str>,
    ) -> NewAiUsageEvent {
        NewAiUsageEvent {
            project_id: None,
            provider: "openai".to_string(),
            model: "gpt-4".to_string(),
            target_name: target_name.to_string(),
            session_name: session_name.to_string(),
            status: status.to_string(),
            duration_ms: 1234,
            prompt_tokens: Some(100),
            completion_tokens: Some(50),
            total_tokens: Some(150),
            estimated_cost: None,
            error_message: None,
            window_number: Some(window_number),
            response_json: response_json.map(|s| s.to_string()),
        }
    }

    #[tokio::test]
    async fn ai_usage_repository_insert_window_event_persists_window_number() {
        let pool = setup_test_db().await;
        let repo = AiUsageRepository::new(pool);

        let event = new_window_event("local", "dev", 3, "success", Some("{\"app\":\"vim\"}"));
        let inserted = repo.insert(&event).await.expect("insert");

        assert_eq!(inserted.target_name, "local");
        assert_eq!(inserted.session_name, "dev");
        assert_eq!(inserted.window_number, Some(3));
        assert_eq!(inserted.status, "success");
        assert_eq!(
            inserted.response_json,
            Some("{\"app\":\"vim\"}".to_string())
        );
    }

    #[tokio::test]
    async fn ai_usage_repository_list_filters_by_status() {
        let pool = setup_test_db().await;
        let repo = AiUsageRepository::new(pool);

        repo.insert(&new_window_event("local", "dev", 1, "success", None))
            .await
            .expect("insert success");
        repo.insert(&new_window_event("local", "dev", 2, "error", None))
            .await
            .expect("insert error");
        repo.insert(&new_window_event("local", "dev", 3, "success", None))
            .await
            .expect("insert success 2");

        let all = repo.list(10, None, None).await.expect("list all");
        assert_eq!(all.len(), 3);

        let errors = repo
            .list(10, None, Some("error"))
            .await
            .expect("list errors");
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].window_number, Some(2));

        let successes = repo
            .list(10, None, Some("success"))
            .await
            .expect("list successes");
        assert_eq!(successes.len(), 2);
    }

    #[tokio::test]
    async fn ai_usage_repository_summary_counts_window_events() {
        let pool = setup_test_db().await;
        let repo = AiUsageRepository::new(pool);

        repo.insert(&new_window_event("local", "dev", 1, "success", None))
            .await
            .expect("insert success");
        repo.insert(&new_window_event("local", "dev", 2, "error", None))
            .await
            .expect("insert error");

        let summary = repo.summary(None).await.expect("summary");
        assert_eq!(summary.total_events, 2);
        assert_eq!(summary.total_success, 1);
        assert_eq!(summary.total_error, 1);
        assert_eq!(summary.total_duration_ms, 2468);
        assert_eq!(summary.total_prompt_tokens, 200);
        assert_eq!(summary.total_completion_tokens, 100);
        assert_eq!(summary.total_tokens, 300);
    }

    #[tokio::test]
    async fn ai_usage_repository_delete_stale_window_events_removes_old_records() {
        let pool = setup_test_db().await;
        let repo = AiUsageRepository::new(pool);

        repo.insert(&new_window_event("local", "dev", 1, "success", None))
            .await
            .expect("insert");

        let deleted = repo
            .delete_stale_window_events(None)
            .await
            .expect("delete stale");
        assert_eq!(deleted, 0);

        let remaining = repo.list(10, None, None).await.expect("list after delete");
        assert_eq!(remaining.len(), 1);
    }
}

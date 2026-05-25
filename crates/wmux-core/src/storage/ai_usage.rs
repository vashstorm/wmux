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
    ) -> Result<Vec<AiUsageEvent>, sqlx::Error> {
        let clamped_limit = limit.min(200).max(1);

        if let Some(pid) = project_id {
            sqlx::query_as::<_, AiUsageEvent>(
                "SELECT id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, window_number, response_json, created_at FROM ai_usage_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
            )
            .bind(pid)
            .bind(clamped_limit)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, AiUsageEvent>(
                "SELECT id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, window_number, response_json, created_at FROM ai_usage_events ORDER BY created_at DESC LIMIT ?"
            )
            .bind(clamped_limit)
            .fetch_all(&self.pool)
            .await
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


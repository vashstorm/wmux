use anyhow::Result;
use sqlx::SqlitePool;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::config::random_hex;
use crate::storage::models::{AiUsageEvent, AiUsageSummary, NewAiUsageEvent};

fn now_utc() -> String {
    OffsetDateTime::now_utc().format(&Rfc3339).expect("RFC3339 format is infallible")
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
            "INSERT INTO ai_usage_events (id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        .bind(&now)
        .execute(&self.pool)
        .await?;

        self.get_by_id(&id).await
    }

    async fn get_by_id(&self, id: &str) -> Result<AiUsageEvent, sqlx::Error> {
        sqlx::query_as::<_, AiUsageEvent>(
            "SELECT id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at FROM ai_usage_events WHERE id = ?"
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
                "SELECT id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at FROM ai_usage_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
            )
            .bind(pid)
            .bind(clamped_limit)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, AiUsageEvent>(
                "SELECT id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at FROM ai_usage_events ORDER BY created_at DESC LIMIT ?"
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db;

    async fn setup_test_db() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");
        let pool = db::create_pool(&db_path).await.expect("create pool");
        db::run_migrations(&pool).await.expect("run migrations");
        (pool, dir)
    }

    #[tokio::test]
    async fn ai_usage_insert_and_list() {
        let (pool, _dir) = setup_test_db().await;
        let repo = AiUsageRepository::new(pool);

        let event1 = NewAiUsageEvent {
            project_id: None,
            provider: "openai".to_string(),
            model: "gpt-4".to_string(),
            target_name: "test-target".to_string(),
            session_name: "test-session".to_string(),
            status: "success".to_string(),
            duration_ms: 100,
            prompt_tokens: Some(50),
            completion_tokens: Some(30),
            total_tokens: Some(80),
            estimated_cost: Some(0.01),
            error_message: None,
        };

        let event2 = NewAiUsageEvent {
            project_id: None,
            provider: "anthropic".to_string(),
            model: "claude-3".to_string(),
            target_name: "test-target-2".to_string(),
            session_name: "test-session-2".to_string(),
            status: "error".to_string(),
            duration_ms: 200,
            prompt_tokens: Some(40),
            completion_tokens: None,
            total_tokens: Some(40),
            estimated_cost: Some(0.005),
            error_message: Some("rate limit".to_string()),
        };

        let inserted1 = repo.insert(&event1).await.expect("insert event1");
        let inserted2 = repo.insert(&event2).await.expect("insert event2");

        let list = repo.list(10, None).await.expect("list events");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, inserted2.id);
        assert_eq!(list[1].id, inserted1.id);

        let list_limited = repo.list(1, None).await.expect("list limited");
        assert_eq!(list_limited.len(), 1);
        assert_eq!(list_limited[0].id, inserted2.id);
    }

    #[tokio::test]
    async fn ai_usage_retention_boundary() {
        let (pool, _dir) = setup_test_db().await;
        let repo = AiUsageRepository::new(pool);

        let cutoff = "2024-01-15T00:00:00Z";

        sqlx::query(
            "INSERT INTO ai_usage_events (id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind("old-id")
        .bind(None::<String>)
        .bind("test")
        .bind("model")
        .bind("")
        .bind("")
        .bind("success")
        .bind(0)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(None::<f64>)
        .bind(None::<String>)
        .bind("2024-01-01T00:00:00Z")
        .execute(&repo.pool)
        .await
        .expect("insert old event");

        sqlx::query(
            "INSERT INTO ai_usage_events (id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind("boundary-id")
        .bind(None::<String>)
        .bind("test")
        .bind("model")
        .bind("")
        .bind("")
        .bind("success")
        .bind(0)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(None::<f64>)
        .bind(None::<String>)
        .bind("2024-01-15T00:00:00Z")
        .execute(&repo.pool)
        .await
        .expect("insert boundary event");

        sqlx::query(
            "INSERT INTO ai_usage_events (id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind("new-id")
        .bind(None::<String>)
        .bind("test")
        .bind("model")
        .bind("")
        .bind("")
        .bind("success")
        .bind(0)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(None::<f64>)
        .bind(None::<String>)
        .bind("2024-01-20T00:00:00Z")
        .execute(&repo.pool)
        .await
        .expect("insert new event");

        let deleted = repo.delete_expired(cutoff).await.expect("delete expired");
        assert_eq!(deleted, 1);

        let remaining = repo.list(10, None).await.expect("list remaining");
        assert_eq!(remaining.len(), 2);

        let ids: Vec<&str> = remaining.iter().map(|e| e.id.as_str()).collect();
        assert!(ids.contains(&"boundary-id"));
        assert!(ids.contains(&"new-id"));
        assert!(!ids.contains(&"old-id"));
    }

    #[tokio::test]
    async fn ai_usage_summary() {
        let (pool, _dir) = setup_test_db().await;
        let repo = AiUsageRepository::new(pool);

        let success_event = NewAiUsageEvent {
            project_id: None,
            provider: "openai".to_string(),
            model: "gpt-4".to_string(),
            target_name: "".to_string(),
            session_name: "".to_string(),
            status: "success".to_string(),
            duration_ms: 100,
            prompt_tokens: Some(50),
            completion_tokens: Some(30),
            total_tokens: Some(80),
            estimated_cost: Some(0.01),
            error_message: None,
        };

        let error_event = NewAiUsageEvent {
            project_id: None,
            provider: "openai".to_string(),
            model: "gpt-4".to_string(),
            target_name: "".to_string(),
            session_name: "".to_string(),
            status: "error".to_string(),
            duration_ms: 50,
            prompt_tokens: Some(20),
            completion_tokens: None,
            total_tokens: Some(20),
            estimated_cost: Some(0.002),
            error_message: Some("timeout".to_string()),
        };

        repo.insert(&success_event).await.expect("insert success");
        repo.insert(&error_event).await.expect("insert error");

        let summary = repo.summary(None).await.expect("get summary");
        assert_eq!(summary.total_events, 2);
        assert_eq!(summary.total_success, 1);
        assert_eq!(summary.total_error, 1);
        assert_eq!(summary.total_duration_ms, 150);
        assert_eq!(summary.total_prompt_tokens, 70);
        assert_eq!(summary.total_completion_tokens, 30);
        assert_eq!(summary.total_tokens, 100);
        assert!((summary.total_estimated_cost - 0.012).abs() < 0.001);
    }

    #[tokio::test]
    async fn ai_usage_list_with_project_filter() {
        let (pool, _dir) = setup_test_db().await;
        let repo = AiUsageRepository::new(pool);

        sqlx::query(
            "INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind("project-A")
        .bind("Project A")
        .bind("")
        .bind("")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(&repo.pool)
        .await
        .expect("insert project A");

        sqlx::query(
            "INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind("project-B")
        .bind("Project B")
        .bind("")
        .bind("")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(&repo.pool)
        .await
        .expect("insert project B");

        sqlx::query(
            "INSERT INTO ai_usage_events (id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind("event-1")
        .bind("project-A")
        .bind("test")
        .bind("model")
        .bind("")
        .bind("")
        .bind("success")
        .bind(0)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(None::<f64>)
        .bind(None::<String>)
        .bind("2024-01-01T00:00:00Z")
        .execute(&repo.pool)
        .await
        .expect("insert event 1");

        sqlx::query(
            "INSERT INTO ai_usage_events (id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind("event-2")
        .bind("project-B")
        .bind("test")
        .bind("model")
        .bind("")
        .bind("")
        .bind("success")
        .bind(0)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(None::<f64>)
        .bind(None::<String>)
        .bind("2024-01-02T00:00:00Z")
        .execute(&repo.pool)
        .await
        .expect("insert event 2");

        let list_a = repo.list(10, Some("project-A")).await.expect("list project A");
        assert_eq!(list_a.len(), 1);
        assert_eq!(list_a[0].id, "event-1");

        let list_b = repo.list(10, Some("project-B")).await.expect("list project B");
        assert_eq!(list_b.len(), 1);
        assert_eq!(list_b[0].id, "event-2");

        let list_all = repo.list(10, None).await.expect("list all");
        assert_eq!(list_all.len(), 2);
    }

    #[tokio::test]
    async fn ai_usage_limit_clamping() {
        let (pool, _dir) = setup_test_db().await;
        let repo = AiUsageRepository::new(pool);

        for i in 0..205 {
            sqlx::query(
                "INSERT INTO ai_usage_events (id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(format!("event-{}", i))
            .bind(None::<String>)
            .bind("test")
            .bind("model")
            .bind("")
            .bind("")
            .bind("success")
            .bind(0)
            .bind(None::<i64>)
            .bind(None::<i64>)
            .bind(None::<i64>)
            .bind(None::<f64>)
            .bind(None::<String>)
            .bind(format!("2024-01-{:02}T00:00:00Z", i % 28 + 1))
            .execute(&repo.pool)
            .await
            .expect("insert event");
        }

        let list_300 = repo.list(300, None).await.expect("list with 300 limit");
        assert_eq!(list_300.len(), 200);

        let list_0 = repo.list(0, None).await.expect("list with 0 limit");
        assert_eq!(list_0.len(), 1);
    }

    #[tokio::test]
    async fn ai_usage_summary_with_project_filter() {
        let (pool, _dir) = setup_test_db().await;
        let repo = AiUsageRepository::new(pool);

        sqlx::query(
            "INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind("project-A")
        .bind("Project A")
        .bind("")
        .bind("")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(&repo.pool)
        .await
        .expect("insert project A");

        sqlx::query(
            "INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind("project-B")
        .bind("Project B")
        .bind("")
        .bind("")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(&repo.pool)
        .await
        .expect("insert project B");

        sqlx::query(
            "INSERT INTO ai_usage_events (id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind("event-1")
        .bind("project-A")
        .bind("test")
        .bind("model")
        .bind("")
        .bind("")
        .bind("success")
        .bind(100)
        .bind(50)
        .bind(30)
        .bind(80)
        .bind(0.01)
        .bind(None::<String>)
        .bind("2024-01-01T00:00:00Z")
        .execute(&repo.pool)
        .await
        .expect("insert event 1");

        sqlx::query(
            "INSERT INTO ai_usage_events (id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind("event-2")
        .bind("project-B")
        .bind("test")
        .bind("model")
        .bind("")
        .bind("")
        .bind("success")
        .bind(200)
        .bind(60)
        .bind(40)
        .bind(100)
        .bind(0.02)
        .bind(None::<String>)
        .bind("2024-01-02T00:00:00Z")
        .execute(&repo.pool)
        .await
        .expect("insert event 2");

        let summary_a = repo.summary(Some("project-A")).await.expect("summary project A");
        assert_eq!(summary_a.total_events, 1);
        assert_eq!(summary_a.total_duration_ms, 100);
        assert_eq!(summary_a.total_tokens, 80);

        let summary_all = repo.summary(None).await.expect("summary all");
        assert_eq!(summary_all.total_events, 2);
        assert_eq!(summary_all.total_duration_ms, 300);
        assert_eq!(summary_all.total_tokens, 180);
    }
}
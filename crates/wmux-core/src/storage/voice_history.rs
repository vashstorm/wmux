use sqlx::SqlitePool;
use uuid::Uuid;

use crate::storage::models::OmniConversationMessage;

#[derive(Debug, thiserror::Error)]
pub enum OmniHistoryRepoError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

pub struct OmniHistoryRepository {
    pool: SqlitePool,
}

impl OmniHistoryRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert(
        &self,
        msg: &OmniConversationMessage,
    ) -> Result<OmniConversationMessage, OmniHistoryRepoError> {
        let id = if msg.id.trim().is_empty() {
            Uuid::new_v4().to_string()
        } else {
            msg.id.clone()
        };
        let created_at = if msg.created_at.trim().is_empty() {
            now_utc()
        } else {
            msg.created_at.clone()
        };

        sqlx::query(
            "INSERT INTO voice_conversation_messages (id, conversation_id, role, kind, text, event_json, target_name, session_name, window_name, pane_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&msg.conversation_id)
        .bind(&msg.role)
        .bind(&msg.kind)
        .bind(&msg.text)
        .bind(&msg.event_json)
        .bind(&msg.target_name)
        .bind(&msg.session_name)
        .bind(&msg.window_name)
        .bind(msg.pane_index)
        .bind(&created_at)
        .execute(&self.pool)
        .await?;

        self.get_by_id(&id).await
    }

    pub async fn list(
        &self,
        conversation_id: &str,
        limit: Option<i64>,
        before: Option<&str>,
    ) -> Result<Vec<OmniConversationMessage>, OmniHistoryRepoError> {
        let clamped_limit = limit.unwrap_or(50).clamp(1, 200);

        let rows = if let Some(before) = before {
            sqlx::query_as::<_, OmniConversationMessage>(
                "SELECT id, conversation_id, role, kind, text, event_json, target_name, session_name, window_name, pane_index, created_at FROM voice_conversation_messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
            )
            .bind(conversation_id)
            .bind(before)
            .bind(clamped_limit)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, OmniConversationMessage>(
                "SELECT id, conversation_id, role, kind, text, event_json, target_name, session_name, window_name, pane_index, created_at FROM voice_conversation_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?",
            )
            .bind(conversation_id)
            .bind(clamped_limit)
            .fetch_all(&self.pool)
            .await?
        };

        Ok(rows)
    }

    pub async fn clear(&self) -> Result<(), OmniHistoryRepoError> {
        sqlx::query("DELETE FROM voice_conversation_messages")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_by_id(&self, id: &str) -> Result<OmniConversationMessage, OmniHistoryRepoError> {
        let row = sqlx::query_as::<_, OmniConversationMessage>(
            "SELECT id, conversation_id, role, kind, text, event_json, target_name, session_name, window_name, pane_index, created_at FROM voice_conversation_messages WHERE id = ?",
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

    async fn setup_test_db() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create pool");
        db::run_migrations(&pool).await.expect("run migrations");
        (pool, dir)
    }

    fn message(conversation_id: &str, created_at: &str, text: &str) -> OmniConversationMessage {
        OmniConversationMessage {
            id: String::new(),
            conversation_id: conversation_id.to_string(),
            role: "user".to_string(),
            kind: "transcript".to_string(),
            text: text.to_string(),
            event_json: None,
            target_name: Some("local".to_string()),
            session_name: Some("session-a".to_string()),
            window_name: Some("window-a".to_string()),
            pane_index: Some(1),
            created_at: created_at.to_string(),
        }
    }

    #[tokio::test]
    async fn voice_history_repository_insert_and_list_returns_newest_first() {
        let (pool, _dir) = setup_test_db().await;
        let repo = OmniHistoryRepository::new(pool);

        repo.insert(&message("conv-a", "2026-05-28T10:00:00Z", "first"))
            .await
            .expect("insert first");
        repo.insert(&message("conv-a", "2026-05-28T10:01:00Z", "second"))
            .await
            .expect("insert second");
        repo.insert(&message("conv-b", "2026-05-28T10:02:00Z", "other"))
            .await
            .expect("insert other");

        let rows = repo
            .list("conv-a", Some(50), None)
            .await
            .expect("list messages");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].text, "second");
        assert_eq!(rows[1].text, "first");
        assert!(uuid::Uuid::parse_str(&rows[0].id).is_ok());
    }

    #[tokio::test]
    async fn voice_history_repository_applies_before_cursor_and_limit_clamp() {
        let (pool, _dir) = setup_test_db().await;
        let repo = OmniHistoryRepository::new(pool);

        for index in 0..205 {
            let created_at = format!("2026-05-28T10:{index:02}:00Z");
            repo.insert(&message("conv-a", &created_at, &format!("msg-{index}")))
                .await
                .expect("insert message");
        }

        let one = repo
            .list("conv-a", Some(0), None)
            .await
            .expect("list minimum clamp");
        assert_eq!(one.len(), 1);

        let capped = repo
            .list("conv-a", Some(1000), None)
            .await
            .expect("list maximum clamp");
        assert_eq!(capped.len(), 200);

        let before = repo
            .list("conv-a", Some(10), Some("2026-05-28T10:05:00Z"))
            .await
            .expect("list before cursor");
        assert_eq!(before.len(), 5);
        assert_eq!(before[0].created_at, "2026-05-28T10:04:00Z");
    }

    #[tokio::test]
    async fn voice_history_repository_clear_deletes_all_messages() {
        let (pool, _dir) = setup_test_db().await;
        let repo = OmniHistoryRepository::new(pool);

        repo.insert(&message("conv-a", "2026-05-28T10:00:00Z", "first"))
            .await
            .expect("insert first");
        repo.insert(&message("conv-b", "2026-05-28T10:01:00Z", "second"))
            .await
            .expect("insert second");

        repo.clear().await.expect("clear history");

        let rows = repo
            .list("conv-a", Some(50), None)
            .await
            .expect("list after clear");
        assert!(rows.is_empty());
    }
}

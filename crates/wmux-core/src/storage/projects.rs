use anyhow::Result;
use sqlx::SqlitePool;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::config::random_hex;
use crate::storage::models::{NewProject, Project, UpdateProject};

#[derive(Debug, thiserror::Error)]
pub enum ProjectRepoError {
    #[error("project not found: {0}")]
    NotFound(String),
    #[error("project name already exists: {0}")]
    NameConflict(String),
    #[error("validation error: {0}")]
    ValidationError(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

fn now_utc() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("RFC3339 format is infallible")
}

fn validate_project_name(name: &str) -> Result<(), ProjectRepoError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ProjectRepoError::ValidationError(
            "name cannot be empty or whitespace".to_string(),
        ));
    }
    if trimmed.len() > 80 {
        return Err(ProjectRepoError::ValidationError(
            "name cannot exceed 80 characters".to_string(),
        ));
    }
    if trimmed.contains(':') {
        return Err(ProjectRepoError::ValidationError(
            "name cannot contain colon (:)".to_string(),
        ));
    }
    for ch in trimmed.chars() {
        let code = ch as u32;
        if code <= 0x1F || code == 0x7F {
            return Err(ProjectRepoError::ValidationError(
                "name cannot contain ASCII control characters".to_string(),
            ));
        }
    }
    Ok(())
}

pub struct ProjectRepository {
    pool: SqlitePool,
}

impl ProjectRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> Result<Vec<Project>, ProjectRepoError> {
        let projects = sqlx::query_as::<_, Project>(
            "SELECT id, name, path, description, session_name, status, workdir, layout_json, details_json, progress_json, ai_html, ai_status, ai_error, last_synced_at, schema_version, created_at, updated_at FROM projects ORDER BY updated_at DESC"
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(projects)
    }

    pub async fn get_by_id(&self, id: &str) -> Result<Project, ProjectRepoError> {
        let project = sqlx::query_as::<_, Project>(
            "SELECT id, name, path, description, session_name, status, workdir, layout_json, details_json, progress_json, ai_html, ai_status, ai_error, last_synced_at, schema_version, created_at, updated_at FROM projects WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        match project {
            Some(p) => Ok(p),
            None => Err(ProjectRepoError::NotFound(id.to_string())),
        }
    }

    pub async fn create(&self, new_project: &NewProject) -> Result<Project, ProjectRepoError> {
        validate_project_name(&new_project.name)?;

        let id = random_hex(16);
        let now = now_utc();
        let session_name = new_project
            .session_name
            .clone()
            .unwrap_or_else(|| new_project.name.clone());
        validate_project_name(&session_name)?;
        let workdir = new_project.workdir.clone().unwrap_or_default();
        let layout_json = new_project
            .layout_json
            .clone()
            .unwrap_or_else(|| "{\"schemaVersion\":1,\"windows\":[]}".to_string());
        let details_json = new_project.details_json.clone().unwrap_or_default();
        let progress_json = new_project.progress_json.clone().unwrap_or_default();

        let result = sqlx::query(
            "INSERT INTO projects (id, name, path, description, session_name, workdir, layout_json, details_json, progress_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&new_project.name)
        .bind(&new_project.path)
        .bind(&new_project.description)
        .bind(&session_name)
        .bind(&workdir)
        .bind(&layout_json)
        .bind(&details_json)
        .bind(&progress_json)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => Ok(Project {
                id,
                name: new_project.name.clone(),
                path: new_project.path.clone(),
                description: new_project.description.clone(),
                session_name,
                status: "stopped".to_string(),
                workdir,
                layout_json,
                details_json,
                progress_json,
                ai_html: String::new(),
                ai_status: "idle".to_string(),
                ai_error: String::new(),
                last_synced_at: None,
                schema_version: 1,
                created_at: now.clone(),
                updated_at: now,
            }),
            Err(err) => {
                if let sqlx::Error::Database(db_err) = &err {
                    if db_err.code().as_deref() == Some("2067") {
                        return Err(ProjectRepoError::NameConflict(new_project.name.clone()));
                    }
                }
                Err(ProjectRepoError::Database(err))
            }
        }
    }

    pub async fn update(
        &self,
        id: &str,
        update: &UpdateProject,
    ) -> Result<Project, ProjectRepoError> {
        let now = now_utc();

        let current = self.get_by_id(id).await?;

        let new_name = if update.name.is_empty() {
            &current.name
        } else {
            validate_project_name(&update.name)?;
            &update.name
        };
        let new_path = if update.path.is_empty() {
            &current.path
        } else {
            &update.path
        };
        let new_description = if update.description.is_empty() {
            &current.description
        } else {
            &update.description
        };
        let new_session_name = if let Some(ref sn) = update.session_name {
            validate_project_name(sn)?;
            sn
        } else {
            &current.session_name
        };
        let new_workdir = update.workdir.as_ref().unwrap_or(&current.workdir);
        let new_layout_json = update.layout_json.as_ref().unwrap_or(&current.layout_json);
        let new_details_json = update
            .details_json
            .as_ref()
            .unwrap_or(&current.details_json);
        let new_progress_json = update
            .progress_json
            .as_ref()
            .unwrap_or(&current.progress_json);

        let result = sqlx::query(
            "UPDATE projects SET name = ?, path = ?, description = ?, session_name = ?, workdir = ?, layout_json = ?, details_json = ?, progress_json = ?, updated_at = ? WHERE id = ?",
        )
        .bind(new_name)
        .bind(new_path)
        .bind(new_description)
        .bind(new_session_name)
        .bind(new_workdir)
        .bind(new_layout_json)
        .bind(new_details_json)
        .bind(new_progress_json)
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => Ok(Project {
                id: id.to_string(),
                name: new_name.clone(),
                path: new_path.clone(),
                description: new_description.clone(),
                session_name: new_session_name.clone(),
                status: current.status.clone(),
                workdir: new_workdir.clone(),
                layout_json: new_layout_json.clone(),
                details_json: new_details_json.clone(),
                progress_json: new_progress_json.clone(),
                ai_html: current.ai_html.clone(),
                ai_status: current.ai_status.clone(),
                ai_error: current.ai_error.clone(),
                last_synced_at: current.last_synced_at.clone(),
                schema_version: current.schema_version,
                created_at: current.created_at.clone(),
                updated_at: now,
            }),
            Err(err) => {
                if let sqlx::Error::Database(db_err) = &err {
                    if db_err.code().as_deref() == Some("2067") {
                        return Err(ProjectRepoError::NameConflict(new_name.clone()));
                    }
                }
                Err(ProjectRepoError::Database(err))
            }
        }
    }

    pub async fn update_snapshot(
        &self,
        id: &str,
        layout_json: &str,
        status: &str,
        last_synced_at: &str,
        current: &Project,
    ) -> Result<Project, ProjectRepoError> {
        let now = now_utc();

        let result = sqlx::query(
            "UPDATE projects SET layout_json = ?, status = ?, last_synced_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(layout_json)
        .bind(status)
        .bind(last_synced_at)
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(ProjectRepoError::NotFound(id.to_string()));
        }

        Ok(Project {
            status: status.to_string(),
            layout_json: layout_json.to_string(),
            last_synced_at: Some(last_synced_at.to_string()),
            updated_at: now,
            ..current.clone()
        })
    }

    pub async fn update_ai_result(
        &self,
        id: &str,
        ai_html: &str,
        ai_status: &str,
        ai_error: &str,
        current: &Project,
    ) -> Result<Project, ProjectRepoError> {
        let now = now_utc();

        let result = sqlx::query(
            "UPDATE projects SET ai_html = ?, ai_status = ?, ai_error = ?, updated_at = ? WHERE id = ?",
        )
        .bind(ai_html)
        .bind(ai_status)
        .bind(ai_error)
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(ProjectRepoError::NotFound(id.to_string()));
        }

        Ok(Project {
            ai_html: ai_html.to_string(),
            ai_status: ai_status.to_string(),
            ai_error: ai_error.to_string(),
            updated_at: now,
            ..current.clone()
        })
    }

    pub async fn delete(&self, id: &str) -> Result<(), ProjectRepoError> {
        let result = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(ProjectRepoError::NotFound(id.to_string()));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db;

    fn dummy() -> Project {
        Project {
            status: "stopped".to_string(),
            ai_status: "idle".to_string(),
            schema_version: 1,
            ..Default::default()
        }
    }

    async fn setup_test_db() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");
        let pool = db::create_pool(&db_path).await.expect("create pool");
        db::run_migrations(&pool).await.expect("run migrations");
        (pool, dir)
    }

    #[tokio::test]
    async fn project_crud() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let new_project = NewProject {
            name: "test-project".to_string(),
            path: "/path/to/project".to_string(),
            description: "Test description".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };
        let created = repo.create(&new_project).await.expect("create project");
        assert_eq!(created.name, "test-project");
        assert_eq!(created.path, "/path/to/project");
        assert_eq!(created.session_name, "test-project");
        assert_eq!(created.status, "stopped");
        assert_eq!(created.ai_status, "idle");

        let list = repo.list().await.expect("list projects");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, created.id);

        let fetched = repo.get_by_id(&created.id).await.expect("get project");
        assert_eq!(fetched.name, "test-project");

        let update = UpdateProject {
            name: "updated-name".to_string(),
            path: "/new/path".to_string(),
            description: "Updated description".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };
        let updated = repo
            .update(&created.id, &update)
            .await
            .expect("update project");
        assert_eq!(updated.name, "updated-name");
        assert_eq!(updated.path, "/new/path");
        assert_eq!(updated.description, "Updated description");

        repo.delete(&created.id).await.expect("delete project");

        let list_after = repo.list().await.expect("list after delete");
        assert_eq!(list_after.len(), 0);
    }

    #[tokio::test]
    async fn project_duplicate_name_returns_conflict() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let new_project = NewProject {
            name: "duplicate-test".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };
        repo.create(&new_project).await.expect("create first");

        let result = repo.create(&new_project).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::NameConflict(name) => assert_eq!(name, "duplicate-test"),
            other => panic!("expected NameConflict, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn project_update_nonexistent_returns_not_found() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let update = UpdateProject {
            name: "new-name".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };

        let result = repo.update("nonexistent-id", &update).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::NotFound(id) => assert_eq!(id, "nonexistent-id"),
            other => panic!("expected NotFound, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn project_delete_nonexistent_returns_not_found() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let result = repo.delete("nonexistent-id").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::NotFound(id) => assert_eq!(id, "nonexistent-id"),
            other => panic!("expected NotFound, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn project_update_with_same_name_succeeds() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let new_project = NewProject {
            name: "same-name-test".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };
        let created = repo.create(&new_project).await.expect("create");

        let update = UpdateProject {
            name: "".to_string(),
            path: "/new/path".to_string(),
            description: "".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };
        let updated = repo.update(&created.id, &update).await.expect("update");
        assert_eq!(updated.name, "same-name-test");
        assert_eq!(updated.path, "/new/path");
    }

    #[tokio::test]
    async fn project_update_conflict_name() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let p1 = NewProject {
            name: "project-one".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };
        let created1 = repo.create(&p1).await.expect("create p1");

        let p2 = NewProject {
            name: "project-two".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };
        repo.create(&p2).await.expect("create p2");

        let update = UpdateProject {
            name: "project-two".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };
        let result = repo.update(&created1.id, &update).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::NameConflict(name) => assert_eq!(name, "project-two"),
            other => panic!("expected NameConflict, got {:?}", other),
        }
    }

    #[test]
    fn validate_project_name_empty_fails() {
        let result = validate_project_name("");
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::ValidationError(msg) => assert!(msg.contains("empty")),
            other => panic!("expected ValidationError, got {:?}", other),
        }

        let result = validate_project_name("   ");
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::ValidationError(msg) => assert!(msg.contains("empty")),
            other => panic!("expected ValidationError, got {:?}", other),
        }
    }

    #[test]
    fn validate_project_name_too_long_fails() {
        let long_name = "a".repeat(81);
        let result = validate_project_name(&long_name);
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::ValidationError(msg) => assert!(msg.contains("80")),
            other => panic!("expected ValidationError, got {:?}", other),
        }
    }

    #[test]
    fn validate_project_name_with_colon_fails() {
        let result = validate_project_name("my:project");
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::ValidationError(msg) => assert!(msg.contains("colon")),
            other => panic!("expected ValidationError, got {:?}", other),
        }
    }

    #[test]
    fn validate_project_name_with_control_char_fails() {
        let result = validate_project_name("my\x00project");
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::ValidationError(msg) => assert!(msg.contains("control")),
            other => panic!("expected ValidationError, got {:?}", other),
        }

        let result = validate_project_name("my\x1Fproject");
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::ValidationError(msg) => assert!(msg.contains("control")),
            other => panic!("expected ValidationError, got {:?}", other),
        }

        let result = validate_project_name("my\x7Fproject");
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::ValidationError(msg) => assert!(msg.contains("control")),
            other => panic!("expected ValidationError, got {:?}", other),
        }
    }

    #[test]
    fn validate_project_name_valid_passes() {
        assert!(validate_project_name("valid-name").is_ok());
        assert!(validate_project_name("Valid Name With Spaces").is_ok());
        assert!(validate_project_name("name-with-dashes_and_underscores").is_ok());
        assert!(validate_project_name(&"a".repeat(80)).is_ok());
    }

    #[tokio::test]
    async fn project_create_invalid_name_fails() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let new_project = NewProject {
            name: "invalid:name".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };

        let result = repo.create(&new_project).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::ValidationError(msg) => assert!(msg.contains("colon")),
            other => panic!("expected ValidationError, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn project_create_invalid_session_name_fails() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let new_project = NewProject {
            name: "valid-name".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: Some("invalid:session".to_string()),
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };

        let result = repo.create(&new_project).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::ValidationError(msg) => assert!(msg.contains("colon")),
            other => panic!("expected ValidationError, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn project_update_invalid_name_fails() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let new_project = NewProject {
            name: "valid-name".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };
        let created = repo.create(&new_project).await.expect("create");

        let update = UpdateProject {
            name: "invalid:name".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: None,
            workdir: None,
            layout_json: None,
            details_json: None,
            progress_json: None,
        };

        let result = repo.update(&created.id, &update).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::ValidationError(msg) => assert!(msg.contains("colon")),
            other => panic!("expected ValidationError, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn project_update_snapshot_preserves_description_and_ai_fields() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let new_project = NewProject {
            name: "snapshot-test".to_string(),
            path: "".to_string(),
            description: "original description".to_string(),
            session_name: None,
            workdir: None,
            layout_json: Some("{\"schemaVersion\":1,\"windows\":[]}".to_string()),
            details_json: Some("{\"detail\":\"original\"}".to_string()),
            progress_json: Some("{\"progress\":50}".to_string()),
        };
        let created = repo.create(&new_project).await.expect("create");

        let updated = repo
            .update_snapshot(
                &created.id,
                "{\"schemaVersion\":2,\"windows\":[]}",
                "running",
                "2026-05-22T12:00:00Z",
                &created,
            )
            .await
            .expect("update_snapshot");

        assert_eq!(updated.layout_json, "{\"schemaVersion\":2,\"windows\":[]}");
        assert_eq!(updated.status, "running");
        assert_eq!(
            updated.last_synced_at,
            Some("2026-05-22T12:00:00Z".to_string())
        );
        assert_eq!(updated.description, "original description");
        assert_eq!(updated.details_json, "{\"detail\":\"original\"}");
        assert_eq!(updated.progress_json, "{\"progress\":50}");
        assert_eq!(updated.ai_html, "");
        assert_eq!(updated.ai_status, "idle");
        assert_eq!(updated.ai_error, "");
    }

    #[tokio::test]
    async fn project_update_ai_result_preserves_layout_and_status() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let new_project = NewProject {
            name: "ai-test".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: None,
            workdir: None,
            layout_json: Some("{\"schemaVersion\":1,\"windows\":[]}".to_string()),
            details_json: None,
            progress_json: None,
        };
        let created = repo.create(&new_project).await.expect("create");

        let snapshot = repo
            .update_snapshot(
                &created.id,
                "{\"schemaVersion\":2,\"windows\":[]}",
                "running",
                "2026-05-22T12:00:00Z",
                &created,
            )
            .await
            .expect("update_snapshot");

        assert_eq!(snapshot.layout_json, "{\"schemaVersion\":2,\"windows\":[]}");
        assert_eq!(snapshot.status, "running");

        let updated = repo
            .update_ai_result(
                &created.id,
                "<html>AI result</html>",
                "completed",
                "",
                &snapshot,
            )
            .await
            .expect("update_ai_result");

        assert_eq!(updated.ai_html, "<html>AI result</html>");
        assert_eq!(updated.ai_status, "completed");
        assert_eq!(updated.ai_error, "");
        assert_eq!(updated.layout_json, "{\"schemaVersion\":2,\"windows\":[]}");
        assert_eq!(updated.status, "running");
        assert_eq!(
            updated.last_synced_at,
            Some("2026-05-22T12:00:00Z".to_string())
        );
    }

    #[tokio::test]
    async fn project_update_snapshot_nonexistent_returns_not_found() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let result = repo
            .update_snapshot(
                "nonexistent-id",
                "{}",
                "running",
                "2026-05-22T12:00:00Z",
                &dummy(),
            )
            .await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::NotFound(id) => assert_eq!(id, "nonexistent-id"),
            other => panic!("expected NotFound, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn project_update_ai_result_nonexistent_returns_not_found() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        let result = repo
            .update_ai_result("nonexistent-id", "<html></html>", "idle", "", &dummy())
            .await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::NotFound(id) => assert_eq!(id, "nonexistent-id"),
            other => panic!("expected NotFound, got {:?}", other),
        }
    }
}

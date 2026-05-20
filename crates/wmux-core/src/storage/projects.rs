use anyhow::Result;
use sqlx::SqlitePool;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::config::random_hex;
use crate::storage::models::{NewProject, Project, UpdateProject};

#[derive(Debug, thiserror::Error)]
pub enum ProjectRepoError {
    #[error("project not found: {0}")]
    NotFound(String),
    #[error("project name already exists: {0}")]
    NameConflict(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

fn now_utc() -> String {
    OffsetDateTime::now_utc().format(&Rfc3339).expect("RFC3339 format is infallible")
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
            "SELECT id, name, path, description, created_at, updated_at FROM projects ORDER BY updated_at DESC"
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(projects)
    }

    pub async fn get_by_id(&self, id: &str) -> Result<Project, ProjectRepoError> {
        let project = sqlx::query_as::<_, Project>(
            "SELECT id, name, path, description, created_at, updated_at FROM projects WHERE id = ?"
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
        let id = random_hex(16);
        let now = now_utc();

        let result = sqlx::query(
            "INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&new_project.name)
        .bind(&new_project.path)
        .bind(&new_project.description)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => self.get_by_id(&id).await,
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

        // First, get the current project to check existence
        let current = self.get_by_id(id).await?;

        // Determine which fields to update (non-empty strings override)
        let new_name = if update.name.is_empty() {
            &current.name
        } else {
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

        let result = sqlx::query(
            "UPDATE projects SET name = ?, path = ?, description = ?, updated_at = ? WHERE id = ?"
        )
        .bind(new_name)
        .bind(new_path)
        .bind(new_description)
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => self.get_by_id(id).await,
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

        // Create
        let new_project = NewProject {
            name: "test-project".to_string(),
            path: "/path/to/project".to_string(),
            description: "Test description".to_string(),
        };
        let created = repo.create(&new_project).await.expect("create project");
        assert_eq!(created.name, "test-project");
        assert_eq!(created.path, "/path/to/project");

        // List - should contain the created project
        let list = repo.list().await.expect("list projects");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, created.id);

        // Get by ID
        let fetched = repo.get_by_id(&created.id).await.expect("get project");
        assert_eq!(fetched.name, "test-project");

        // Update
        let update = UpdateProject {
            name: "updated-name".to_string(),
            path: "/new/path".to_string(),
            description: "Updated description".to_string(),
        };
        let updated = repo.update(&created.id, &update).await.expect("update project");
        assert_eq!(updated.name, "updated-name");
        assert_eq!(updated.path, "/new/path");
        assert_eq!(updated.description, "Updated description");

        // Delete
        repo.delete(&created.id).await.expect("delete project");

        // List should be empty
        let list_after = repo.list().await.expect("list after delete");
        assert_eq!(list_after.len(), 0);
    }

    #[tokio::test]
    async fn project_duplicate_name_returns_conflict() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        // Create first project
        let new_project = NewProject {
            name: "duplicate-test".to_string(),
            path: "".to_string(),
            description: "".to_string(),
        };
        repo.create(&new_project).await.expect("create first");

        // Try to create with same name
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

        // Create project
        let new_project = NewProject {
            name: "same-name-test".to_string(),
            path: "".to_string(),
            description: "".to_string(),
        };
        let created = repo.create(&new_project).await.expect("create");

        // Update with empty name (should keep original)
        let update = UpdateProject {
            name: "".to_string(),
            path: "/new/path".to_string(),
            description: "".to_string(),
        };
        let updated = repo.update(&created.id, &update).await.expect("update");
        assert_eq!(updated.name, "same-name-test");
        assert_eq!(updated.path, "/new/path");
    }

    #[tokio::test]
    async fn project_update_conflict_name() {
        let (pool, _dir) = setup_test_db().await;
        let repo = ProjectRepository::new(pool);

        // Create two projects
        let p1 = NewProject {
            name: "project-one".to_string(),
            path: "".to_string(),
            description: "".to_string(),
        };
        let created1 = repo.create(&p1).await.expect("create p1");

        let p2 = NewProject {
            name: "project-two".to_string(),
            path: "".to_string(),
            description: "".to_string(),
        };
        repo.create(&p2).await.expect("create p2");

        // Try to update p1 to have p2's name
        let update = UpdateProject {
            name: "project-two".to_string(),
            path: "".to_string(),
            description: "".to_string(),
        };
        let result = repo.update(&created1.id, &update).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectRepoError::NameConflict(name) => assert_eq!(name, "project-two"),
            other => panic!("expected NameConflict, got {:?}", other),
        }
    }
}
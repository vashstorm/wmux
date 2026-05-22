use axum::Router;
use axum::http::{Method, header};
use axum::middleware;
use axum::routing::{delete, get, post};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use crate::handlers::{ai_stats, config, connections, health, logs, projects, sessions, terminal};
use crate::http::api_not_found;
use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    let protected_api = Router::new()
        .route(
            "/connections",
            get(connections::list).post(connections::create),
        )
        .route("/connections/health", get(connections::list_health))
        .route(
            "/connections/{id}",
            get(connections::get)
                .put(connections::update)
                .delete(connections::delete),
        )
        .route("/connections/{id}/health", get(connections::health))
        .route(
            "/targets/{target}/sessions",
            get(sessions::list_sessions).post(sessions::create_session),
        )
        .route(
            "/targets/{target}/sessions/{session}",
            delete(sessions::delete_session).patch(sessions::rename_session),
        )
        .route(
            "/targets/{target}/sessions/{session}/analyze",
            post(sessions::analyze_session),
        )
        .route(
            "/targets/{target}/sessions/{session}/windows",
            get(sessions::list_windows).post(sessions::create_window),
        )
        .route(
            "/targets/{target}/sessions/{session}/windows/{window}",
            delete(sessions::delete_window),
        )
        .route(
            "/targets/{target}/sessions/{session}/windows/{window}/panes",
            get(sessions::list_panes),
        )
        .route(
            "/targets/{target}/sessions/{session}/windows/{window}/panes/{pane}/split",
            post(sessions::split_pane),
        )
        .route(
            "/targets/{target}/sessions/{session}/windows/{window}/panes/{pane}",
            delete(sessions::delete_pane),
        )
        .route(
            "/connections/{id}/sessions",
            get(sessions::list_sessions).post(sessions::create_session),
        )
        .route(
            "/connections/{id}/sessions/{session}",
            delete(sessions::delete_session).patch(sessions::rename_session),
        )
        .route(
            "/connections/{id}/sessions/{session}/analyze",
            post(sessions::analyze_session),
        )
        .route(
            "/connections/{id}/sessions/{session}/windows",
            get(sessions::list_windows).post(sessions::create_window),
        )
        .route(
            "/connections/{id}/sessions/{session}/windows/{window}",
            delete(sessions::delete_window),
        )
        .route(
            "/connections/{id}/sessions/{session}/windows/{window}/panes",
            get(sessions::list_panes),
        )
        .route(
            "/connections/{id}/sessions/{session}/windows/{window}/panes/{pane}/split",
            post(sessions::split_pane),
        )
        .route(
            "/connections/{id}/sessions/{session}/windows/{window}/panes/{pane}",
            delete(sessions::delete_pane),
        )
        .route("/config", get(config::get).put(config::update))
        .route("/projects", get(projects::list).post(projects::create))
        .route(
            "/projects/{id}",
            get(projects::get)
                .put(projects::update)
                .delete(projects::delete),
        )
        .route(
            "/logs/errors",
            get(logs::get_error_logs).delete(logs::clear_error_logs),
        )
        .route("/ai/stats", get(ai_stats::get_stats))
        .route(
            "/ai/stats/cleanup",
            post(ai_stats::cleanup_stale_window_events),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            crate::middleware::auth_middleware,
        ));

    let terminal_api = Router::new()
        .route("/terminal", get(terminal::websocket))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            crate::middleware::terminal_auth_middleware,
        ));

    let api = Router::new()
        .route("/health", get(health::get))
        .merge(protected_api)
        .merge(terminal_api)
        .fallback(api_not_found);

    let static_service = ServeDir::new(state.assets_dir.clone())
        .fallback(ServeFile::new(state.assets_dir.join("index.html")));

    Router::new()
        .nest("/api", api)
        .fallback_service(static_service)
        .layer(middleware::from_fn(crate::middleware::logging_middleware))
        .layer(cors_layer())
        .with_state(state)
}

fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{Body, to_bytes};
    use axum::http::{Request, StatusCode, header};
    use serde_json::{Value, json};
    use std::fs;
    use std::thread;
    use std::time::Duration;
    use tower::ServiceExt;
    use wmux_core::config::Config;
    use wmux_core::logging::LoggingHandle;

    const TOKEN: &str = "test-token";

    fn test_app(config: Value) -> (Router, tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).expect("serialize config"),
        )
        .expect("write config");
        let store = Config::load(&config_path).expect("load config");
        let state = AppState::new(store, assets_dir, LoggingHandle::empty());
        (router(state), dir, config_path)
    }

    fn test_app_with_error_log(
        config: Value,
    ) -> (
        Router,
        tempfile::TempDir,
        std::path::PathBuf,
        wmux_core::logging::ErrorLogHandle,
    ) {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).expect("serialize config"),
        )
        .expect("write config");
        let store = Config::load(&config_path).expect("load config");

        let error_log_path = dir.path().join("wmux-error.log");
        let writer = wmux_core::logging::RotatingFileWriter::open(error_log_path.clone(), 0, 0)
            .expect("open test error log");
        let shared_writer = std::sync::Arc::new(std::sync::Mutex::new(writer));
        let error_handle =
            wmux_core::logging::ErrorLogHandle::new(shared_writer.clone(), error_log_path.clone());
        let logging_handle = wmux_core::logging::LoggingHandle {
            error_log: Some(error_handle.clone()),
        };

        let state = AppState::new(store, assets_dir, logging_handle);
        (router(state), dir, config_path, error_handle)
    }

    async fn test_app_with_storage() -> (Router, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        let runtime_dir = dir.path().join("runtime");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");

        let config = json!({
            "schemaVersion": 1,
            "server": { "bind": "127.0.0.1:0" },
            "auth": { "token": TOKEN },
            "tmux": { "path": "tmux" },
            "connections": [],
            "ui": { "theme": "dark" },
            "path": runtime_dir.to_string_lossy().into_owned(),
            "intelligence": {
                "enabled": true,
                "provider": "openai",
                "model": "test-model",
                "apiKey": "secret-key",
                "baseURL": "http://127.0.0.1:1"
            }
        });
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).expect("serialize config"),
        )
        .expect("write config");

        let store = Config::load(&config_path).expect("load config");
        let state = AppState::with_storage(store, assets_dir, LoggingHandle::empty(), &config_path)
            .await
            .expect("create state with storage");

        (router(state), dir)
    }

    fn base_config() -> Value {
        json!({
            "schemaVersion": 1,
            "server": { "bind": "127.0.0.1:0" },
            "auth": { "token": TOKEN },
            "tmux": { "path": "tmux" },
            "connections": [],
            "ui": { "theme": "dark" },
            "intelligence": {
                "enabled": true,
                "provider": "openai",
                "model": "test-model",
                "apiKey": "secret-key",
                "baseURL": "http://127.0.0.1:1"
            }
        })
    }

    fn request(method: &str, uri: &str, body: Option<Value>) -> Request<Body> {
        let mut builder = Request::builder().method(method).uri(uri);
        if uri != "/api/health" {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
        }
        if body.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        builder
            .body(match body {
                Some(value) => Body::from(value.to_string()),
                None => Body::empty(),
            })
            .expect("request")
    }

    async fn json_body(response: axum::response::Response) -> Value {
        let bytes = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("read body");
        serde_json::from_slice(&bytes).expect("json body")
    }

    #[tokio::test]
    async fn health_endpoint_allows_no_auth() {
        let (app, _dir, _config_path) = test_app(base_config());

        let response = app
            .oneshot(request("GET", "/api/health", None))
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(json_body(response).await, json!({ "status": "ok" }));
    }

    #[tokio::test]
    async fn auth_middleware_rejects_missing_token_and_accepts_bearer() {
        let (app, _dir, _config_path) = test_app(base_config());

        let unauthorized = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/connections")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            json_body(unauthorized).await,
            json!({ "error": { "code": "unauthorized", "message": "missing or invalid authentication token" } })
        );

        let authorized = app
            .oneshot(request("GET", "/api/connections", None))
            .await
            .expect("response");
        assert_eq!(authorized.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn cors_preflight_allows_protected_api_without_auth() {
        let (app, _dir, _config_path) = test_app(base_config());

        let response = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/config")
                    .header(header::ORIGIN, "http://localhost:5173")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert!(response.status().is_success());
        assert_eq!(
            response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
            Some(&header::HeaderValue::from_static("*"))
        );
    }

    #[tokio::test]
    async fn config_get_sanitizes_secret_fields() {
        let (app, _dir, _config_path) = test_app(base_config());

        let response = app
            .oneshot(request("GET", "/api/config", None))
            .await
            .expect("response");
        let body = json_body(response).await;

        assert_eq!(body["auth"]["token"], "");
        assert_eq!(body["auth"]["tokenConfigured"], true);
        assert_eq!(
            body["intelligence"]["providers"][0]["apiKeyConfigured"],
            true
        );
        assert!(!body.to_string().contains("secret-key"));
    }

    #[tokio::test]
    async fn connections_crud_uses_actual_handlers() {
        let (app, _dir, _config_path) = test_app(base_config());

        let created_response = app
            .clone()
            .oneshot(request(
                "POST",
                "/api/connections",
                Some(json!({ "type": "local" })),
            ))
            .await
            .expect("response");
        assert_eq!(created_response.status(), StatusCode::CREATED);
        let created = json_body(created_response).await;
        let id = created["targetName"]
            .as_str()
            .expect("target name")
            .to_string();
        assert_eq!(created["type"], "local");

        let get_response = app
            .clone()
            .oneshot(request("GET", &format!("/api/connections/{id}"), None))
            .await
            .expect("response");
        assert_eq!(get_response.status(), StatusCode::OK);

        let update_response = app
            .clone()
            .oneshot(request(
                "PUT",
                &format!("/api/connections/{id}"),
                Some(json!({ "targetName": id, "type": "local" })),
            ))
            .await
            .expect("response");
        assert_eq!(update_response.status(), StatusCode::OK);

        let delete_response = app
            .oneshot(request("DELETE", &format!("/api/connections/{id}"), None))
            .await
            .expect("response");
        assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn connections_persist_to_config_file() {
        let (app, _dir, config_path) = test_app(base_config());

        let created_response = app
            .clone()
            .oneshot(request(
                "POST",
                "/api/connections",
                Some(json!({ "type": "local" })),
            ))
            .await
            .expect("response");
        assert_eq!(created_response.status(), StatusCode::CREATED);
        let created = json_body(created_response).await;
        let id = created["targetName"]
            .as_str()
            .expect("target name")
            .to_string();

        let config_content = fs::read_to_string(&config_path).expect("read config");
        let config: Value = serde_json::from_str(&config_content).expect("parse config");
        assert_eq!(
            config["connections"]
                .as_array()
                .expect("connections array")
                .len(),
            1
        );
        assert_eq!(config["connections"][0]["id"], id);

        let delete_response = app
            .oneshot(request("DELETE", &format!("/api/connections/{id}"), None))
            .await
            .expect("response");
        assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);

        let config_content = fs::read_to_string(&config_path).expect("read config");
        let config: Value = serde_json::from_str(&config_content).expect("parse config");
        assert_eq!(
            config["connections"]
                .as_array()
                .expect("connections array")
                .len(),
            0
        );
    }

    #[tokio::test]
    async fn connections_loaded_from_config_on_startup() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");

        let config_with_connection = json!({
            "schemaVersion": 1,
            "server": { "bind": "127.0.0.1:0" },
            "auth": { "token": TOKEN },
            "tmux": { "path": "tmux" },
            "connections": [{ "type": "local" }],
            "ui": { "theme": "dark" }
        });
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config_with_connection).expect("serialize"),
        )
        .expect("write config");

        let store = Config::load(&config_path).expect("load config");
        let state = AppState::new(store, assets_dir, LoggingHandle::empty());
        let app = router(state);

        let response = app
            .oneshot(request("GET", "/api/connections", None))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        let connections = body["data"].as_array().expect("connections array");
        assert_eq!(connections.len(), 1);
        assert_eq!(connections[0]["type"], "local");
    }

    #[tokio::test]
    async fn config_conflict_returns_409() {
        let (app, _dir, config_path) = test_app(base_config());

        for attempt in 0..20 {
            thread::sleep(Duration::from_millis(10));
            fs::write(
                &config_path,
                json!({
                    "schemaVersion": 1,
                    "server": { "bind": format!("127.0.0.1:{attempt}") },
                    "auth": { "token": TOKEN },
                    "tmux": { "path": "tmux" },
                    "connections": [],
                    "ui": { "theme": "dark" }
                })
                .to_string(),
            )
            .expect("overwrite config");
        }

        let response = app
            .oneshot(request("PUT", "/api/config", Some(base_config())))
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(json_body(response).await["error"]["code"], "conflict");
    }

    #[tokio::test]
    async fn target_routes_return_stable_not_found_errors() {
        let (app, _dir, _config_path) = test_app(base_config());

        let connection_response = app
            .clone()
            .oneshot(request(
                "POST",
                "/api/connections",
                Some(json!({ "type": "local" })),
            ))
            .await
            .expect("response");
        let connection = json_body(connection_response).await;
        let id = connection["targetName"].as_str().expect("target name");
        let analyze_response = app
            .oneshot(request(
                "POST",
                &format!("/api/targets/{id}/sessions/playwright/analyze"),
                None,
            ))
            .await
            .expect("response");
        assert_eq!(analyze_response.status(), StatusCode::NOT_FOUND);
        let analyze_body = json_body(analyze_response).await;
        assert_eq!(analyze_body["error"]["code"], "not_found");
        assert!(!analyze_body.to_string().contains("connectionId"));
    }

    #[tokio::test]
    async fn logs_errors_unauthorized_rejected() {
        let (app, _dir, _config_path) = test_app(base_config());
        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/logs/errors")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn logs_errors_authorized_get_returns_json() {
        let (app, _dir, _config_path) = test_app(base_config());
        let response = app
            .oneshot(request("GET", "/api/logs/errors", None))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["enabled"], json!(false));
        assert_eq!(body["path"], serde_json::Value::Null);
        assert_eq!(body["maxLines"], json!(1000));
        assert!(body["lines"].as_array().is_some());
        assert_eq!(body["truncated"], json!(false));
    }

    #[tokio::test]
    async fn logs_errors_authorized_get_with_handle_returns_path() {
        let (app, dir, _config_path, _error_handle) = test_app_with_error_log(base_config());
        let response = app
            .oneshot(request("GET", "/api/logs/errors", None))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["enabled"], json!(true));
        assert_eq!(
            body["path"],
            json!(
                dir.path()
                    .join("wmux-error.log")
                    .to_string_lossy()
                    .into_owned()
            )
        );
    }

    #[tokio::test]
    async fn logs_errors_authorized_delete_returns_204() {
        let (app, _dir, _config_path) = test_app(base_config());
        let response = app
            .oneshot(request("DELETE", "/api/logs/errors", None))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn logs_errors_get_truncates_at_1000_lines() {
        let (app, _dir, _config_path, error_handle) = test_app_with_error_log(base_config());

        {
            let mut f = error_handle.writer.lock().expect("lock");
            use std::io::Write;
            for i in 0..1010 {
                writeln!(f, "error line {}", i).expect("write");
            }
            f.flush().expect("flush");
        }

        let response = app
            .oneshot(request("GET", "/api/logs/errors", None))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["maxLines"], json!(1000));
        assert_eq!(body["truncated"], json!(true));
        let lines = body["lines"].as_array().expect("lines array");
        assert_eq!(lines.len(), 1000);
        assert_eq!(lines[0], "error line 10");
    }

    #[tokio::test]
    async fn logs_errors_delete_then_write_new_line() {
        let (app, _dir, _config_path, error_handle) = test_app_with_error_log(base_config());

        {
            let mut f = error_handle.writer.lock().expect("lock");
            use std::io::Write;
            writeln!(f, "old error line").expect("write");
            f.flush().expect("flush");
        }

        let del_response = app
            .clone()
            .oneshot(request("DELETE", "/api/logs/errors", None))
            .await
            .expect("response");
        assert_eq!(del_response.status(), StatusCode::NO_CONTENT);

        {
            let mut f = error_handle.writer.lock().expect("lock");
            use std::io::Write;
            writeln!(f, "new error after clear").expect("write");
            f.flush().expect("flush");
        }

        let response = app
            .oneshot(request("GET", "/api/logs/errors", None))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        let lines = body["lines"].as_array().expect("lines array");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0], "new error after clear");
        let lines_str = serde_json::to_string(&lines).expect("serialize");
        assert!(!lines_str.contains("old error line"));
    }

    #[tokio::test]
    async fn projects_routes_crud() {
        let (app, _dir) = test_app_with_storage().await;

        // Create
        let create_resp = app
            .clone()
            .oneshot(request(
                "POST",
                "/api/projects",
                Some(json!({
                    "name": "test-project",
                    "path": "/tmp/test",
                    "description": "desc"
                })),
            ))
            .await
            .expect("response");
        assert_eq!(create_resp.status(), StatusCode::CREATED);
        let created = json_body(create_resp).await;
        let id = created["id"].as_str().unwrap().to_string();
        assert_eq!(created["name"], "test-project");

        // List
        let list_resp = app
            .clone()
            .oneshot(request("GET", "/api/projects", None))
            .await
            .expect("response");
        assert_eq!(list_resp.status(), StatusCode::OK);
        let list = json_body(list_resp).await;
        assert_eq!(list["data"].as_array().unwrap().len(), 1);

        // Get
        let get_resp = app
            .clone()
            .oneshot(request("GET", &format!("/api/projects/{id}"), None))
            .await
            .expect("response");
        assert_eq!(get_resp.status(), StatusCode::OK);
        let fetched = json_body(get_resp).await;
        assert_eq!(fetched["name"], "test-project");

        // Update
        let update_resp = app
            .clone()
            .oneshot(request(
                "PUT",
                &format!("/api/projects/{id}"),
                Some(json!({
                    "name": "updated-project",
                    "path": "/new/path"
                })),
            ))
            .await
            .expect("response");
        assert_eq!(update_resp.status(), StatusCode::OK);
        let updated = json_body(update_resp).await;
        assert_eq!(updated["name"], "updated-project");

        // Delete
        let del_resp = app
            .clone()
            .oneshot(request("DELETE", &format!("/api/projects/{id}"), None))
            .await
            .expect("response");
        assert_eq!(del_resp.status(), StatusCode::NO_CONTENT);

        // Get after delete → 404
        let get_after = app
            .oneshot(request("GET", &format!("/api/projects/{id}"), None))
            .await
            .expect("response");
        assert_eq!(get_after.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn projects_routes_errors() {
        let (app, _dir) = test_app_with_storage().await;

        // Empty name → 400
        let empty_name_resp = app
            .clone()
            .oneshot(request(
                "POST",
                "/api/projects",
                Some(json!({ "name": "", "path": "" })),
            ))
            .await
            .expect("response");
        assert_eq!(empty_name_resp.status(), StatusCode::BAD_REQUEST);

        // Duplicate name → 409
        app.clone()
            .oneshot(request(
                "POST",
                "/api/projects",
                Some(json!({ "name": "dup", "path": "" })),
            ))
            .await
            .expect("response");
        let dup_resp = app
            .clone()
            .oneshot(request(
                "POST",
                "/api/projects",
                Some(json!({ "name": "dup", "path": "" })),
            ))
            .await
            .expect("response");
        assert_eq!(dup_resp.status(), StatusCode::CONFLICT);

        // Missing id → 404
        let missing = app
            .oneshot(request("GET", "/api/projects/nonexistent", None))
            .await
            .expect("response");
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn ai_stats_route_returns_bounded_data() {
        let (app, _dir) = test_app_with_storage().await;

        let resp = app
            .oneshot(request("GET", "/api/ai/stats?limit=5", None))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        let body = json_body(resp).await;
        assert!(body["data"].as_array().is_some());
        assert!(body["summary"].is_object());
        assert!(body["summary"]["totalEvents"].is_number());
    }

    #[tokio::test]
    async fn ai_stats_route_limit_capped_at_200() {
        let (app, _dir) = test_app_with_storage().await;

        let resp = app
            .oneshot(request("GET", "/api/ai/stats?limit=1000", None))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        let body = json_body(resp).await;
        assert!(body["data"].as_array().unwrap().len() <= 200);
    }

    #[tokio::test]
    async fn ai_stats_cleanup_route_keeps_latest_event_per_window() {
        let (app, dir) = test_app_with_storage().await;
        let db_path = dir.path().join("runtime/data/wmux.db");
        let pool = wmux_core::storage::db::create_pool(&db_path)
            .await
            .expect("create pool");

        for (id, window, created_at) in [
            ("old-window-1", 1_i64, "2024-01-01T00:00:00Z"),
            ("new-window-1", 1_i64, "2024-01-02T00:00:00Z"),
            ("only-window-2", 2_i64, "2024-01-01T00:00:00Z"),
        ] {
            sqlx::query(
                "INSERT INTO ai_usage_events (id, project_id, provider, model, target_name, session_name, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, error_message, window_number, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(id)
            .bind(None::<String>)
            .bind("test")
            .bind("model")
            .bind("local")
            .bind("session-a")
            .bind("success")
            .bind(0)
            .bind(None::<i64>)
            .bind(None::<i64>)
            .bind(None::<i64>)
            .bind(None::<f64>)
            .bind(None::<String>)
            .bind(window)
            .bind(None::<String>)
            .bind(created_at)
            .execute(&pool)
            .await
            .expect("insert event");
        }

        let resp = app
            .clone()
            .oneshot(request("POST", "/api/ai/stats/cleanup", None))
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(json_body(resp).await["deleted"], 1);

        let stats = app
            .oneshot(request("GET", "/api/ai/stats?limit=10", None))
            .await
            .expect("response");
        let body = json_body(stats).await;
        let ids: Vec<&str> = body["data"]
            .as_array()
            .expect("data array")
            .iter()
            .filter_map(|event| event["id"].as_str())
            .collect();

        assert!(ids.contains(&"new-window-1"));
        assert!(ids.contains(&"only-window-2"));
        assert!(!ids.contains(&"old-window-1"));
    }
}

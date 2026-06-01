use std::time::Instant;

use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode, header};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use crate::handlers::connections::{current_config, find_connection, require_local_connection};
use crate::http::ApiError;
use crate::protocol::{OmniServerEvent, OmniSkill, VOICE_FRONTEND_ROUTES};
use crate::state::AppState;
use crate::tmux::{Adapter, TmuxError};
use crate::voice::audit::{
    ActionResult, AuditEntry, AuditLogger, ConfirmationState as AuditConfirmationState,
    redact_secrets,
};
use crate::voice::policy::{
    ConfirmationError, ConfirmationState, classify_risk_level, is_dangerous,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OmniExecutorError {
    pub code: String,
    pub message: String,
}

impl OmniExecutorError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            code: "bad_request".to_string(),
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: "not_found".to_string(),
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            code: "conflict".to_string(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for OmniExecutorError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for OmniExecutorError {}

#[derive(Debug, Clone, PartialEq)]
pub struct OmniSkillExecution {
    pub event: OmniServerEvent,
    pub output: Value,
}

#[derive(Clone)]
struct BackendRoute {
    id: &'static str,
    method: Method,
    risk_skill: &'static str,
    is_write: bool,
}

pub struct OmniSkillExecutor {
    state: AppState,
    confirmation_state: ConfirmationState,
    audit_logger: AuditLogger,
    actor_id: String,
}

impl OmniSkillExecutor {
    pub fn new(state: AppState) -> Self {
        Self::with_components(
            state,
            ConfirmationState::new(),
            AuditLogger::default(),
            "local".to_string(),
        )
    }

    pub fn with_components(
        state: AppState,
        confirmation_state: ConfirmationState,
        audit_logger: AuditLogger,
        actor_id: String,
    ) -> Self {
        Self {
            state,
            confirmation_state,
            audit_logger,
            actor_id,
        }
    }

    pub fn confirmation_state(&self) -> &ConfirmationState {
        &self.confirmation_state
    }

    pub async fn execute_skill(
        &self,
        skill: OmniSkill,
        params: Value,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        self.execute(skill_name(&skill), params).await
    }

    pub async fn execute(
        &self,
        skill: &str,
        params: Value,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        let start = Instant::now();
        let result = self.execute_unconfirmed(skill, params.clone()).await;
        self.audit(skill, &params, audit_target(&params), &result, false, start)
            .await;
        result
    }

    pub async fn execute_confirmed(
        &self,
        skill: &str,
        confirmation_id: Uuid,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        let start = Instant::now();
        let params = self
            .confirmation_state
            .verify_confirmation(confirmation_id)
            .await
            .map_err(confirmation_error)?;
        let result = self.execute_confirmed_params(skill, params.clone()).await;
        self.audit(skill, &params, audit_target(&params), &result, true, start)
            .await;
        result
    }

    pub async fn execute_preconfirmed(
        &self,
        skill: &str,
        params: Value,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        let start = Instant::now();
        let result = self.execute_confirmed_params(skill, params.clone()).await;
        self.audit(skill, &params, audit_target(&params), &result, true, start)
            .await;
        result
    }

    async fn execute_unconfirmed(
        &self,
        skill: &str,
        params: Value,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        match skill {
            "navigate_frontend" => self.navigate_frontend(params).await,
            "invoke_backend_route" => self.invoke_backend_route(params, false).await,
            "list_sessions" => self.list_sessions(params).await,
            "create_session" => self.create_session(params).await,
            "rename_session" => self.rename_session(params).await,
            "delete_session" => self.delete_session(params, false).await,
            "send_to_pane" => self.send_to_pane(params, false).await,
            "new_chat" => self.new_chat(params).await,
            "get_current_focus" => self.get_current_focus(params).await,
            "read_pane_output" => self.read_pane_output(params).await,
            "get_config" => self.get_config(params).await,
            "check_health" => self.check_health(params).await,
            "create_window" => self.create_window(params).await,
            "rename_window" => self.rename_window(params).await,
            "split_pane" => self.split_pane(params).await,
            "focus_pane" => self.focus_pane(params).await,
            "run_project" => self.run_project(params, false).await,
            "list_projects" => {
                self.execute_backend_route_skill("list_projects", "projects.list", params, false)
                    .await
            }
            "create_project" => {
                self.execute_backend_route_skill("create_project", "projects.create", params, false)
                    .await
            }
            "update_project" => {
                self.execute_backend_route_skill("update_project", "projects.update", params, false)
                    .await
            }
            "delete_project" => {
                self.execute_backend_route_skill("delete_project", "projects.delete", params, false)
                    .await
            }
            "launch_project" => {
                self.execute_backend_route_skill("launch_project", "projects.launch", params, false)
                    .await
            }
            "sync_project_from_tmux" => {
                self.execute_backend_route_skill(
                    "sync_project_from_tmux",
                    "projects.sync_from_tmux",
                    params,
                    false,
                )
                .await
            }
            "generate_project_ai_html" => {
                self.execute_backend_route_skill(
                    "generate_project_ai_html",
                    "projects.generate_ai_html",
                    params,
                    false,
                )
                .await
            }
            "analyze_session" => {
                self.execute_backend_route_skill(
                    "analyze_session",
                    "sessions.analyze",
                    params,
                    false,
                )
                .await
            }
            "list_tmux_analysis" => {
                self.execute_backend_route_skill(
                    "list_tmux_analysis",
                    "tmux_analysis.list",
                    params,
                    false,
                )
                .await
            }
            "cleanup_tmux_analysis" => {
                self.execute_backend_route_skill(
                    "cleanup_tmux_analysis",
                    "tmux_analysis.cleanup",
                    params,
                    false,
                )
                .await
            }
            "list_ai_logs" => {
                self.execute_backend_route_skill("list_ai_logs", "ai_logs.list", params, false)
                    .await
            }
            "clear_ai_logs" => {
                self.execute_backend_route_skill("clear_ai_logs", "ai_logs.clear", params, false)
                    .await
            }
            "delete_window" => self.delete_window(params, false).await,
            "kill_pane" => self.kill_pane(params, false).await,
            "clear_pane" => self.clear_pane(params).await,
            other => Err(OmniExecutorError::bad_request(format!(
                "unsupported voice skill: {other}"
            ))),
        }
    }

    async fn execute_confirmed_params(
        &self,
        skill: &str,
        params: Value,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        match skill {
            "invoke_backend_route" => self.invoke_backend_route(params, true).await,
            "delete_session" => self.delete_session(params, true).await,
            "send_to_pane" => self.send_to_pane(params, true).await,
            "run_project" => self.run_project(params, true).await,
            "delete_project" => {
                self.execute_backend_route_skill("delete_project", "projects.delete", params, true)
                    .await
            }
            "cleanup_tmux_analysis" => {
                self.execute_backend_route_skill(
                    "cleanup_tmux_analysis",
                    "tmux_analysis.cleanup",
                    params,
                    true,
                )
                .await
            }
            "clear_ai_logs" => {
                self.execute_backend_route_skill("clear_ai_logs", "ai_logs.clear", params, true)
                    .await
            }
            "delete_window" => self.delete_window(params, true).await,
            "kill_pane" => self.kill_pane(params, true).await,
            other => Err(OmniExecutorError::bad_request(format!(
                "skill does not support confirmation: {other}"
            ))),
        }
    }

    async fn navigate_frontend(
        &self,
        params: Value,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        let route = required_string(&params, "route")?;
        if !VOICE_FRONTEND_ROUTES.contains(&route.as_str()) {
            return Err(OmniExecutorError::bad_request(format!(
                "frontend route not allowed: {route}"
            )));
        }

        let mut event_params = serde_json::Map::new();
        event_params.insert("route".to_string(), Value::String(route.clone()));
        for field in [
            "target_name",
            "targetName",
            "session",
            "session_name",
            "sessionName",
            "window",
            "window_name",
            "windowName",
            "pane",
            "pane_index",
            "paneIndex",
            "project_id",
            "projectId",
            "project_name",
            "projectName",
        ] {
            if let Some(value) = params.get(field).cloned() {
                event_params.insert(field.to_string(), value);
            }
        }

        let event = OmniServerEvent::IntentReceived {
            skill: "navigate_frontend".to_string(),
            params: Value::Object(event_params.clone()),
            confirmation_required: false,
            confirmation_id: None,
        };
        Ok(OmniSkillExecution {
            event,
            output: json!({ "success": true, "params": Value::Object(event_params) }),
        })
    }

    async fn list_sessions(&self, params: Value) -> Result<OmniSkillExecution, OmniExecutorError> {
        let target_name = required_string(&params, "target_name")?;
        self.execute_backend_request(
            "list_sessions",
            Method::GET,
            format!("/api/targets/{}/sessions", path_segment(&target_name)),
            None,
        )
        .await
    }

    async fn create_session(&self, params: Value) -> Result<OmniSkillExecution, OmniExecutorError> {
        let session_name = required_string(&params, "session_name")?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string(&params, "target_name")?,
            &session_name,
        );
        self.execute_backend_request(
            "create_session",
            Method::POST,
            format!("/api/targets/{}/sessions", path_segment(&target_name)),
            Some(json!({ "name": session_name })),
        )
        .await
    }

    async fn rename_session(&self, params: Value) -> Result<OmniSkillExecution, OmniExecutorError> {
        let session = required_string_alias(&params, &["session", "old_name", "session_name"])?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string(&params, "target_name")?,
            &session,
        );
        let new_name = required_string(&params, "new_name")?;
        self.execute_backend_request(
            "rename_session",
            Method::PATCH,
            format!(
                "/api/targets/{}/sessions/{}",
                path_segment(&target_name),
                path_segment(&session)
            ),
            Some(json!({ "name": new_name })),
        )
        .await
    }

    async fn delete_session(
        &self,
        params: Value,
        confirmed: bool,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        if !confirmed && is_dangerous("delete_session", &params) {
            return self.confirmation_required("delete_session", params).await;
        }

        let session = required_string_alias(&params, &["session", "session_name"])?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string(&params, "target_name")?,
            &session,
        );
        self.execute_backend_request(
            "delete_session",
            Method::DELETE,
            format!(
                "/api/targets/{}/sessions/{}",
                path_segment(&target_name),
                path_segment(&session)
            ),
            None,
        )
        .await
    }

    async fn send_to_pane(
        &self,
        params: Value,
        confirmed: bool,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        let session = required_string_alias(&params, &["session", "session_name", "sessionName"])?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string_alias(&params, &["target_name", "targetName"])?,
            &session,
        );
        let window = required_string_alias(&params, &["window", "window_name", "windowName"])?;
        let pane = required_string_alias(&params, &["pane", "pane_index", "paneIndex"])?;
        let text = required_text(&params, "text")?;

        let policy_params = send_to_pane_policy_params(&params);
        if !confirmed && is_dangerous("send_to_pane", &policy_params) {
            return self.confirmation_required("send_to_pane", params).await;
        }

        let append_enter =
            bool_param(&params, "append_enter") || bool_param(&params, "appendEnter");
        let execute = bool_param(&params, "execute");
        let multiline = bool_param(&params, "multiline");
        let control = bool_param(&params, "control");
        let control_sequence =
            optional_string_alias(&params, &["control_sequence", "controlSequence"]);
        let keys = send_keys_payload(
            &text,
            append_enter || execute,
            control,
            control_sequence.as_deref(),
            multiline,
        )?;

        let adapter = self.tmux_adapter_for_target(&target_name)?;
        let panes = adapter
            .list_panes(&session, &window)
            .await
            .map_err(tmux_error)?;
        if !panes.iter().any(|pane_info| pane_matches(pane_info, &pane)) {
            return Err(OmniExecutorError::not_found(format!(
                "pane not found: {target_name}/{session}/{window}/{pane}"
            )));
        }

        let target = tmux_pane_target(&session, &window, &pane);
        let key_refs = keys.iter().map(String::as_str).collect::<Vec<_>>();
        adapter
            .send_keys(&target, key_refs.as_slice())
            .await
            .map_err(tmux_error)?;

        Ok(OmniSkillExecution {
            event: OmniServerEvent::ActionResult {
                skill: "send_to_pane".to_string(),
                success: true,
                error: None,
            },
            output: json!({
                "skill": "send_to_pane",
                "success": true,
                "target": {
                    "target_name": target_name,
                    "session": session,
                    "window": window,
                    "pane": pane,
                }
            }),
        })
    }

    async fn new_chat(&self, _params: Value) -> Result<OmniSkillExecution, OmniExecutorError> {
        let params = json!({});
        Ok(OmniSkillExecution {
            event: OmniServerEvent::IntentReceived {
                skill: "new_chat".to_string(),
                params: params.clone(),
                confirmation_required: false,
                confirmation_id: None,
            },
            output: json!({
                "success": true,
                "action": "new_chat",
            }),
        })
    }

    async fn invoke_backend_route(
        &self,
        params: Value,
        confirmed: bool,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        let route_id = required_string(&params, "route_id")?;
        let route = backend_route(&route_id).ok_or_else(|| {
            OmniExecutorError::bad_request(format!("backend route not allowed: {route_id}"))
        })?;
        let route_params = self.normalize_route_params_for_local_session(
            route.id,
            params.get("params").cloned().unwrap_or_else(|| json!({})),
        );

        let policy_params = json!({
            "route_id": route.id,
            "method": route.method.as_str(),
            "params": route_params,
        });
        let _risk_level = classify_risk_level(route.risk_skill, &policy_params);
        if route.is_write && !confirmed && is_dangerous(route.risk_skill, &policy_params) {
            return self
                .confirmation_required("invoke_backend_route", params)
                .await;
        }

        let (path, body) = route_request(&route, &route_params)?;
        self.execute_backend_request(route.id, route.method.clone(), path, body)
            .await
    }

    async fn execute_backend_route_skill(
        &self,
        skill: &str,
        route_id: &str,
        params: Value,
        confirmed: bool,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        let route = backend_route(route_id).ok_or_else(|| {
            OmniExecutorError::bad_request(format!("backend route not allowed: {route_id}"))
        })?;
        let route_params = self.normalize_route_params_for_local_session(route.id, params.clone());
        if route.is_write && !confirmed && is_dangerous(skill, &route_params) {
            return self.confirmation_required(skill, params).await;
        }

        let (path, body) = route_request(&route, &route_params)?;
        self.execute_backend_request(skill, route.method.clone(), path, body)
            .await
    }

    async fn confirmation_required(
        &self,
        skill: &str,
        params: Value,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        let confirmation = self
            .confirmation_state
            .request_confirmation(skill.to_string(), params.clone())
            .await;
        Ok(OmniSkillExecution {
            event: OmniServerEvent::IntentReceived {
                skill: skill.to_string(),
                params,
                confirmation_required: true,
                confirmation_id: Some(confirmation.id.to_string()),
            },
            output: json!({
                "success": false,
                "confirmation_required": true,
                "confirmation_id": confirmation.id.to_string(),
            }),
        })
    }

    async fn execute_backend_request(
        &self,
        skill: &str,
        method: Method,
        path: String,
        body: Option<Value>,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        let request = self.internal_request(method, &path, body)?;
        let response = crate::routes::router(self.state.clone())
            .oneshot(request)
            .await
            .map_err(|error| OmniExecutorError::bad_request(error.to_string()))?;

        let status = response.status();
        let bytes = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .map_err(|error| OmniExecutorError::bad_request(error.to_string()))?;
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .map_err(|error| OmniExecutorError::bad_request(error.to_string()))?
        };

        if !status.is_success() {
            return Err(error_from_response(status, body));
        }

        Ok(OmniSkillExecution {
            event: OmniServerEvent::ActionResult {
                skill: skill.to_string(),
                success: true,
                error: None,
            },
            output: json!({ "success": true, "data": body }),
        })
    }

    fn internal_request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Request<Body>, OmniExecutorError> {
        let mut builder = Request::builder().method(method).uri(path);
        let token = self
            .state
            .store
            .snapshot()
            .map_err(|_| OmniExecutorError::bad_request("failed to read configuration"))?
            .auth
            .token
            .trim()
            .to_string();
        if !token.is_empty() {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        if body.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        builder
            .body(match body {
                Some(value) => Body::from(value.to_string()),
                None => Body::empty(),
            })
            .map_err(|error| OmniExecutorError::bad_request(error.to_string()))
    }

    async fn audit(
        &self,
        skill: &str,
        params: &Value,
        target: String,
        result: &Result<OmniSkillExecution, OmniExecutorError>,
        confirmed: bool,
        start: Instant,
    ) {
        let (confirmation_state, action_result, error_code) = match result {
            Ok(execution) if event_requires_confirmation(&execution.event) => (
                AuditConfirmationState::Pending,
                ActionResult::ConfirmationRequired,
                None,
            ),
            Ok(_) if confirmed => (
                AuditConfirmationState::Confirmed,
                ActionResult::Success,
                None,
            ),
            Ok(_) => (AuditConfirmationState::None, ActionResult::Success, None),
            Err(error) if confirmed => (
                AuditConfirmationState::Confirmed,
                ActionResult::Failure,
                Some(error.code.clone()),
            ),
            Err(error) => (
                AuditConfirmationState::None,
                ActionResult::Failure,
                Some(error.code.clone()),
            ),
        };

        let audit_params = audit_params(skill, params);
        let entry = AuditEntry::new(
            self.actor_id.clone(),
            skill.to_string(),
            audit_params,
            target,
            confirmation_state,
            action_result,
            start.elapsed().as_millis() as u64,
        )
        .with_transcript(text_preview(skill, params))
        .with_error(error_code);
        self.audit_logger.log_action(&entry).await;
    }

    fn tmux_adapter_for_target(&self, target_name: &str) -> Result<Adapter, OmniExecutorError> {
        if target_name != "local" {
            let connection = find_connection(&self.state, target_name).map_err(api_error)?;
            require_local_connection(&connection).map_err(api_error)?;
        }
        let config = current_config(&self.state).map_err(api_error)?;
        Ok(Adapter::new(config.tmux.path))
    }

    // ── New skill handlers ────────────────────────────────────────────────────

    async fn get_current_focus(
        &self,
        _params: Value,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        // Returns an IntentReceived event so the frontend can respond with
        // the current focus via SessionContext.
        let event = OmniServerEvent::IntentReceived {
            skill: "get_current_focus".to_string(),
            params: json!({}),
            confirmation_required: false,
            confirmation_id: None,
        };
        Ok(OmniSkillExecution {
            event,
            output: json!({ "success": true }),
        })
    }

    async fn read_pane_output(
        &self,
        params: Value,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        let target_name = required_string(&params, "target_name")?;
        let session = required_string_alias(&params, &["session", "session_name"])?;
        let target_name =
            self.local_target_when_model_used_session_as_target(target_name, &session);
        let window = required_string_alias(&params, &["window", "window_name"])?;
        let pane = required_string_alias(&params, &["pane", "pane_index"])?;
        let lines = params
            .get("lines")
            .and_then(Value::as_u64)
            .unwrap_or(50)
            .min(500) as u32;
        // bytes = lines * 200 chars avg, capped at 100 KB
        let max_bytes = (lines * 200).min(100_000);

        let adapter = self.tmux_adapter_for_target(&target_name)?;
        let panes = adapter
            .list_panes(&session, &window)
            .await
            .map_err(tmux_error)?;
        let pane_info = panes
            .iter()
            .find(|p| pane_matches(p, &pane))
            .ok_or_else(|| {
                OmniExecutorError::not_found(format!(
                    "pane not found: {target_name}/{session}/{window}/{pane}"
                ))
            })?;
        let target = tmux_pane_target(&session, &window, &pane_info.id);
        let output = adapter
            .capture_pane(&target, max_bytes)
            .await
            .map_err(tmux_error)?;

        Ok(OmniSkillExecution {
            event: OmniServerEvent::ActionResult {
                skill: "read_pane_output".to_string(),
                success: true,
                error: None,
            },
            output: json!({
                "success": true,
                "target": { "target_name": target_name, "session": session, "window": window, "pane": pane },
                "content": output,
                "lines_requested": lines,
            }),
        })
    }

    async fn get_config(&self, _params: Value) -> Result<OmniSkillExecution, OmniExecutorError> {
        self.execute_backend_request("get_config", Method::GET, "/api/config".to_string(), None)
            .await
    }

    async fn check_health(&self, params: Value) -> Result<OmniSkillExecution, OmniExecutorError> {
        let target_name = optional_string_alias(&params, &["target_name"]);
        let path = match target_name.as_deref() {
            Some(t) => format!("/api/targets/{}/health", path_segment(t)),
            None => "/api/health".to_string(),
        };
        self.execute_backend_request("check_health", Method::GET, path, None)
            .await
    }

    async fn create_window(&self, params: Value) -> Result<OmniSkillExecution, OmniExecutorError> {
        let session = required_string_alias(&params, &["session", "session_name"])?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string(&params, "target_name")?,
            &session,
        );
        let window_name = required_string(&params, "window_name")?;
        self.execute_backend_request(
            "create_window",
            Method::POST,
            format!(
                "/api/targets/{}/sessions/{}/windows",
                path_segment(&target_name),
                path_segment(&session)
            ),
            Some(json!({ "name": window_name })),
        )
        .await
    }

    async fn rename_window(&self, params: Value) -> Result<OmniSkillExecution, OmniExecutorError> {
        let session = required_string_alias(&params, &["session", "session_name"])?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string(&params, "target_name")?,
            &session,
        );
        let window = required_string_alias(&params, &["window", "window_name"])?;
        let new_name = required_string(&params, "new_name")?;

        let adapter = self.tmux_adapter_for_target(&target_name)?;
        let windows = adapter.list_windows(&session).await.map_err(tmux_error)?;
        let win_info = windows
            .iter()
            .find(|w| window_matches(w, &window))
            .ok_or_else(|| {
                OmniExecutorError::not_found(format!(
                    "window not found: {target_name}/{session}/{window}"
                ))
            })?;
        let target = format!("{}:={}", session, win_info.name);
        adapter
            .rename_window(&target, &new_name)
            .await
            .map_err(tmux_error)?;

        Ok(OmniSkillExecution {
            event: OmniServerEvent::ActionResult {
                skill: "rename_window".to_string(),
                success: true,
                error: None,
            },
            output: json!({
                "success": true,
                "operation": "rename_window",
                "target_name": target_name,
                "session": session,
                "window": window,
                "new_name": new_name,
            }),
        })
    }

    async fn split_pane(&self, params: Value) -> Result<OmniSkillExecution, OmniExecutorError> {
        let session = required_string_alias(&params, &["session", "session_name"])?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string(&params, "target_name")?,
            &session,
        );
        let window = required_string_alias(&params, &["window", "window_name"])?;
        let pane = required_string_alias(&params, &["pane", "pane_index"])?;
        let horizontal = bool_param(&params, "horizontal");
        self.execute_backend_request(
            "split_pane",
            Method::POST,
            format!(
                "/api/targets/{}/sessions/{}/windows/{}/panes/{}/split",
                path_segment(&target_name),
                path_segment(&session),
                path_segment(&window),
                path_segment(&pane)
            ),
            Some(json!({ "horizontal": horizontal })),
        )
        .await
    }

    async fn focus_pane(&self, params: Value) -> Result<OmniSkillExecution, OmniExecutorError> {
        let session = required_string_alias(&params, &["session", "session_name"])?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string(&params, "target_name")?,
            &session,
        );
        let window = required_string_alias(&params, &["window", "window_name"])?;
        let pane = required_string_alias(&params, &["pane", "pane_index"])?;
        // Focus is a UI-level intent: send IntentReceived so the frontend can
        // update its selection without any backend side effect.
        let event = OmniServerEvent::IntentReceived {
            skill: "focus_pane".to_string(),
            params: json!({
                "target_name": target_name,
                "session_name": session,
                "window_name": window,
                "pane_index": pane,
            }),
            confirmation_required: false,
            confirmation_id: None,
        };
        Ok(OmniSkillExecution {
            event,
            output: json!({ "success": true }),
        })
    }

    async fn run_project(
        &self,
        params: Value,
        confirmed: bool,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        if !confirmed && is_dangerous("run_project", &params) {
            return self.confirmation_required("run_project", params).await;
        }

        let session = required_string_alias(&params, &["session", "session_name"])?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string_alias(&params, &["target_name", "targetName"])?,
            &session,
        );
        let window = required_string_alias(&params, &["window", "window_name", "windowName"])?;
        let pane = required_string_alias(&params, &["pane", "pane_index", "paneIndex"])?;
        let project_path = required_string(&params, "project_path")?;
        let start_command = required_text(&params, "start_command")?;

        let adapter = self.tmux_adapter_for_target(&target_name)?;
        let panes = adapter
            .list_panes(&session, &window)
            .await
            .map_err(tmux_error)?;
        if !panes.iter().any(|p| pane_matches(p, &pane)) {
            return Err(OmniExecutorError::not_found(format!(
                "pane not found: {target_name}/{session}/{window}/{pane}"
            )));
        }

        let target = tmux_pane_target(&session, &window, &pane);
        // Step 1: cd into project directory
        adapter
            .send_keys(&target, &[&format!("cd {project_path}"), "Enter"])
            .await
            .map_err(tmux_error)?;
        // Step 2: run the start command
        adapter
            .send_keys(&target, &[start_command.as_str(), "Enter"])
            .await
            .map_err(tmux_error)?;

        Ok(OmniSkillExecution {
            event: OmniServerEvent::ActionResult {
                skill: "run_project".to_string(),
                success: true,
                error: None,
            },
            output: json!({
                "skill": "run_project",
                "success": true,
                "target": {
                    "target_name": target_name,
                    "session": session,
                    "window": window,
                    "pane": pane,
                },
                "project_path": project_path,
                "start_command": start_command,
            }),
        })
    }

    async fn delete_window(
        &self,
        params: Value,
        confirmed: bool,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        if !confirmed && is_dangerous("delete_window", &params) {
            return self.confirmation_required("delete_window", params).await;
        }

        let session = required_string_alias(&params, &["session", "session_name"])?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string(&params, "target_name")?,
            &session,
        );
        let window = required_string_alias(&params, &["window", "window_name"])?;
        self.execute_backend_request(
            "delete_window",
            Method::DELETE,
            format!(
                "/api/targets/{}/sessions/{}/windows/{}",
                path_segment(&target_name),
                path_segment(&session),
                path_segment(&window)
            ),
            None,
        )
        .await
    }

    async fn kill_pane(
        &self,
        params: Value,
        confirmed: bool,
    ) -> Result<OmniSkillExecution, OmniExecutorError> {
        if !confirmed && is_dangerous("kill_pane", &params) {
            return self.confirmation_required("kill_pane", params).await;
        }

        let session = required_string_alias(&params, &["session", "session_name"])?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string(&params, "target_name")?,
            &session,
        );
        let window = required_string_alias(&params, &["window", "window_name"])?;
        let pane = required_string_alias(&params, &["pane", "pane_index"])?;
        self.execute_backend_request(
            "kill_pane",
            Method::DELETE,
            format!(
                "/api/targets/{}/sessions/{}/windows/{}/panes/{}",
                path_segment(&target_name),
                path_segment(&session),
                path_segment(&window),
                path_segment(&pane)
            ),
            None,
        )
        .await
    }

    async fn clear_pane(&self, params: Value) -> Result<OmniSkillExecution, OmniExecutorError> {
        let session = required_string_alias(&params, &["session", "session_name"])?;
        let target_name = self.local_target_when_model_used_session_as_target(
            required_string(&params, "target_name")?,
            &session,
        );
        let window = required_string_alias(&params, &["window", "window_name"])?;
        let pane = required_string_alias(&params, &["pane", "pane_index"])?;

        let adapter = self.tmux_adapter_for_target(&target_name)?;
        let panes = adapter
            .list_panes(&session, &window)
            .await
            .map_err(tmux_error)?;
        let pane_info = panes
            .iter()
            .find(|p| pane_matches(p, &pane))
            .ok_or_else(|| {
                OmniExecutorError::not_found(format!(
                    "pane not found: {target_name}/{session}/{window}/{pane}"
                ))
            })?;
        let target = tmux_pane_target(&session, &window, &pane_info.id);
        // Send clear command + Enter, then clear tmux scroll history
        adapter
            .send_keys(&target, &["clear", "Enter"])
            .await
            .map_err(tmux_error)?;
        adapter.clear_history(&target).await.map_err(tmux_error)?;

        Ok(OmniSkillExecution {
            event: OmniServerEvent::ActionResult {
                skill: "clear_pane".to_string(),
                success: true,
                error: None,
            },
            output: json!({
                "skill": "clear_pane",
                "success": true,
                "target": {
                    "target_name": target_name,
                    "session": session,
                    "window": window,
                    "pane": pane,
                },
            }),
        })
    }

    fn local_target_when_model_used_session_as_target(
        &self,
        target_name: String,
        session_name: &str,
    ) -> String {
        if target_name == "local" || self.state.connections.find(&target_name).is_some() {
            return target_name;
        }
        if target_name == session_name {
            return "local".to_string();
        }
        target_name
    }

    fn normalize_route_params_for_local_session(&self, route_id: &str, params: Value) -> Value {
        if !route_id.starts_with("sessions.")
            && !route_id.starts_with("windows.")
            && !route_id.starts_with("panes.")
        {
            return params;
        }
        let Some(mut object) = params.as_object().cloned() else {
            return params;
        };
        let Ok(target_name) = required_string(&params, "target_name") else {
            return params;
        };
        let Ok(session_name) = required_string_alias(&params, &["session", "session_name"]) else {
            return params;
        };
        let normalized =
            self.local_target_when_model_used_session_as_target(target_name, &session_name);
        object.insert("target_name".to_string(), Value::String(normalized));
        Value::Object(object)
    }
}

fn skill_name(skill: &OmniSkill) -> &'static str {
    match skill {
        OmniSkill::NavigateFrontend => "navigate_frontend",
        OmniSkill::InvokeBackendRoute => "invoke_backend_route",
        OmniSkill::ListSessions => "list_sessions",
        OmniSkill::CreateSession => "create_session",
        OmniSkill::RenameSession => "rename_session",
        OmniSkill::DeleteSession => "delete_session",
        OmniSkill::SendToPane => "send_to_pane",
        OmniSkill::ConfirmAction => "confirm_action",
        OmniSkill::CancelAction => "cancel_action",
        OmniSkill::NewChat => "new_chat",
        OmniSkill::GetCurrentFocus => "get_current_focus",
        OmniSkill::ReadPaneOutput => "read_pane_output",
        OmniSkill::GetConfig => "get_config",
        OmniSkill::CheckHealth => "check_health",
        OmniSkill::CreateWindow => "create_window",
        OmniSkill::RenameWindow => "rename_window",
        OmniSkill::SplitPane => "split_pane",
        OmniSkill::FocusPane => "focus_pane",
        OmniSkill::RunProject => "run_project",
        OmniSkill::DeleteWindow => "delete_window",
        OmniSkill::KillPane => "kill_pane",
        OmniSkill::ClearPane => "clear_pane",
    }
}

fn backend_route(route_id: &str) -> Option<BackendRoute> {
    match route_id {
        "connections.list" => Some(BackendRoute {
            id: "connections.list",
            method: Method::GET,
            risk_skill: "invoke_backend_route",
            is_write: false,
        }),
        "sessions.list" => Some(BackendRoute {
            id: "sessions.list",
            method: Method::GET,
            risk_skill: "invoke_backend_route",
            is_write: false,
        }),
        "sessions.create" => Some(BackendRoute {
            id: "sessions.create",
            method: Method::POST,
            risk_skill: "invoke_backend_route",
            is_write: true,
        }),
        "sessions.rename" => Some(BackendRoute {
            id: "sessions.rename",
            method: Method::PATCH,
            risk_skill: "invoke_backend_route",
            is_write: true,
        }),
        "sessions.delete" => Some(BackendRoute {
            id: "sessions.delete",
            method: Method::DELETE,
            risk_skill: "invoke_backend_route",
            is_write: true,
        }),
        "sessions.analyze" => Some(BackendRoute {
            id: "sessions.analyze",
            method: Method::POST,
            risk_skill: "analyze_session",
            is_write: true,
        }),
        "windows.list" => Some(BackendRoute {
            id: "windows.list",
            method: Method::GET,
            risk_skill: "invoke_backend_route",
            is_write: false,
        }),
        "windows.create" => Some(BackendRoute {
            id: "windows.create",
            method: Method::POST,
            risk_skill: "invoke_backend_route",
            is_write: true,
        }),
        "windows.delete" => Some(BackendRoute {
            id: "windows.delete",
            method: Method::DELETE,
            risk_skill: "invoke_backend_route",
            is_write: true,
        }),
        "panes.list" => Some(BackendRoute {
            id: "panes.list",
            method: Method::GET,
            risk_skill: "invoke_backend_route",
            is_write: false,
        }),
        "panes.split" => Some(BackendRoute {
            id: "panes.split",
            method: Method::POST,
            risk_skill: "invoke_backend_route",
            is_write: true,
        }),
        "panes.delete" => Some(BackendRoute {
            id: "panes.delete",
            method: Method::DELETE,
            risk_skill: "invoke_backend_route",
            is_write: true,
        }),
        "projects.list" => Some(BackendRoute {
            id: "projects.list",
            method: Method::GET,
            risk_skill: "list_projects",
            is_write: false,
        }),
        "projects.create" => Some(BackendRoute {
            id: "projects.create",
            method: Method::POST,
            risk_skill: "create_project",
            is_write: true,
        }),
        "projects.update" => Some(BackendRoute {
            id: "projects.update",
            method: Method::PUT,
            risk_skill: "update_project",
            is_write: true,
        }),
        "projects.delete" => Some(BackendRoute {
            id: "projects.delete",
            method: Method::DELETE,
            risk_skill: "delete_project",
            is_write: true,
        }),
        "projects.launch" => Some(BackendRoute {
            id: "projects.launch",
            method: Method::POST,
            risk_skill: "launch_project",
            is_write: true,
        }),
        "projects.sync_from_tmux" => Some(BackendRoute {
            id: "projects.sync_from_tmux",
            method: Method::POST,
            risk_skill: "sync_project_from_tmux",
            is_write: true,
        }),
        "projects.generate_ai_html" => Some(BackendRoute {
            id: "projects.generate_ai_html",
            method: Method::POST,
            risk_skill: "generate_project_ai_html",
            is_write: true,
        }),
        "tmux_analysis.list" => Some(BackendRoute {
            id: "tmux_analysis.list",
            method: Method::GET,
            risk_skill: "list_tmux_analysis",
            is_write: false,
        }),
        "tmux_analysis.cleanup" => Some(BackendRoute {
            id: "tmux_analysis.cleanup",
            method: Method::POST,
            risk_skill: "cleanup_tmux_analysis",
            is_write: true,
        }),
        "ai_logs.list" => Some(BackendRoute {
            id: "ai_logs.list",
            method: Method::GET,
            risk_skill: "list_ai_logs",
            is_write: false,
        }),
        "ai_logs.clear" => Some(BackendRoute {
            id: "ai_logs.clear",
            method: Method::DELETE,
            risk_skill: "clear_ai_logs",
            is_write: true,
        }),
        _ => None,
    }
}

fn route_request(
    route: &BackendRoute,
    params: &Value,
) -> Result<(String, Option<Value>), OmniExecutorError> {
    match route.id {
        "connections.list" => Ok(("/api/connections".to_string(), None)),
        "sessions.list" => {
            let target_name = required_string(params, "target_name")?;
            Ok((
                format!("/api/targets/{}/sessions", path_segment(&target_name)),
                None,
            ))
        }
        "sessions.create" => {
            let target_name = required_string(params, "target_name")?;
            let session_name = required_string(params, "session_name")?;
            Ok((
                format!("/api/targets/{}/sessions", path_segment(&target_name)),
                Some(json!({ "name": session_name })),
            ))
        }
        "sessions.rename" => {
            let target_name = required_string(params, "target_name")?;
            let session = required_string_alias(params, &["session", "old_name", "session_name"])?;
            let new_name = required_string(params, "new_name")?;
            Ok((
                format!(
                    "/api/targets/{}/sessions/{}",
                    path_segment(&target_name),
                    path_segment(&session)
                ),
                Some(json!({ "name": new_name })),
            ))
        }
        "sessions.delete" => {
            let target_name = required_string(params, "target_name")?;
            let session = required_string_alias(params, &["session", "session_name"])?;
            Ok((
                format!(
                    "/api/targets/{}/sessions/{}",
                    path_segment(&target_name),
                    path_segment(&session)
                ),
                None,
            ))
        }
        "sessions.analyze" => {
            let target_name = required_string(params, "target_name")?;
            let session = required_string_alias(params, &["session", "session_name"])?;
            Ok((
                format!(
                    "/api/targets/{}/sessions/{}/analyze",
                    path_segment(&target_name),
                    path_segment(&session)
                ),
                None,
            ))
        }
        "windows.list" => {
            let target_name = required_string(params, "target_name")?;
            let session = required_string_alias(params, &["session", "session_name"])?;
            Ok((
                format!(
                    "/api/targets/{}/sessions/{}/windows",
                    path_segment(&target_name),
                    path_segment(&session)
                ),
                None,
            ))
        }
        "windows.create" => {
            let target_name = required_string(params, "target_name")?;
            let session = required_string_alias(params, &["session", "session_name"])?;
            let window_name = required_string(params, "window_name")?;
            Ok((
                format!(
                    "/api/targets/{}/sessions/{}/windows",
                    path_segment(&target_name),
                    path_segment(&session)
                ),
                Some(json!({ "name": window_name })),
            ))
        }
        "windows.delete" => {
            let target_name = required_string(params, "target_name")?;
            let session = required_string_alias(params, &["session", "session_name"])?;
            let window = required_string_alias(params, &["window", "window_name"])?;
            Ok((
                format!(
                    "/api/targets/{}/sessions/{}/windows/{}",
                    path_segment(&target_name),
                    path_segment(&session),
                    path_segment(&window)
                ),
                None,
            ))
        }
        "panes.list" => {
            let target_name = required_string(params, "target_name")?;
            let session = required_string_alias(params, &["session", "session_name"])?;
            let window = required_string_alias(params, &["window", "window_name"])?;
            Ok((
                format!(
                    "/api/targets/{}/sessions/{}/windows/{}/panes",
                    path_segment(&target_name),
                    path_segment(&session),
                    path_segment(&window)
                ),
                None,
            ))
        }
        "panes.split" => {
            let target_name = required_string(params, "target_name")?;
            let session = required_string_alias(params, &["session", "session_name"])?;
            let window = required_string_alias(params, &["window", "window_name"])?;
            let pane = required_string_alias(params, &["pane", "pane_index"])?;
            let horizontal = params
                .get("horizontal")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Ok((
                format!(
                    "/api/targets/{}/sessions/{}/windows/{}/panes/{}/split",
                    path_segment(&target_name),
                    path_segment(&session),
                    path_segment(&window),
                    path_segment(&pane)
                ),
                Some(json!({ "horizontal": horizontal })),
            ))
        }
        "panes.delete" => {
            let target_name = required_string(params, "target_name")?;
            let session = required_string_alias(params, &["session", "session_name"])?;
            let window = required_string_alias(params, &["window", "window_name"])?;
            let pane = required_string_alias(params, &["pane", "pane_index"])?;
            Ok((
                format!(
                    "/api/targets/{}/sessions/{}/windows/{}/panes/{}",
                    path_segment(&target_name),
                    path_segment(&session),
                    path_segment(&window),
                    path_segment(&pane)
                ),
                None,
            ))
        }
        "projects.list" => Ok(("/api/projects".to_string(), None)),
        "projects.create" => {
            let name = required_string(params, "name")?;
            let mut body = serde_json::Map::new();
            body.insert("name".to_string(), Value::String(name));
            insert_optional_string(params, &mut body, "path", "path");
            insert_optional_string(params, &mut body, "description", "description");
            insert_optional_string(params, &mut body, "session_name", "sessionName");
            insert_optional_string(params, &mut body, "workdir", "workdir");
            insert_optional_string(params, &mut body, "layout_json", "layoutJson");
            insert_optional_string(params, &mut body, "details_json", "detailsJson");
            insert_optional_string(params, &mut body, "progress_json", "progressJson");
            Ok(("/api/projects".to_string(), Some(Value::Object(body))))
        }
        "projects.update" => {
            let project_id = required_string_alias(params, &["project_id", "id"])?;
            let mut body = serde_json::Map::new();
            insert_optional_string(params, &mut body, "name", "name");
            insert_optional_string(params, &mut body, "path", "path");
            insert_optional_string(params, &mut body, "description", "description");
            insert_optional_string(params, &mut body, "session_name", "sessionName");
            insert_optional_string(params, &mut body, "workdir", "workdir");
            insert_optional_string(params, &mut body, "layout_json", "layoutJson");
            insert_optional_string(params, &mut body, "details_json", "detailsJson");
            insert_optional_string(params, &mut body, "progress_json", "progressJson");
            Ok((
                format!("/api/projects/{}", path_segment(&project_id)),
                Some(Value::Object(body)),
            ))
        }
        "projects.delete" => {
            let project_id = required_string_alias(params, &["project_id", "id"])?;
            let kill_session = params
                .get("kill_session")
                .or_else(|| params.get("killSession"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let query = if kill_session {
                "?kill_session=true"
            } else {
                ""
            };
            Ok((
                format!("/api/projects/{}{}", path_segment(&project_id), query),
                None,
            ))
        }
        "projects.launch" => {
            let project_id = required_string_alias(params, &["project_id", "id"])?;
            Ok((
                format!("/api/projects/{}/launch", path_segment(&project_id)),
                None,
            ))
        }
        "projects.sync_from_tmux" => {
            let project_id = required_string_alias(params, &["project_id", "id"])?;
            Ok((
                format!("/api/projects/{}/sync-from-tmux", path_segment(&project_id)),
                None,
            ))
        }
        "projects.generate_ai_html" => {
            let project_id = required_string_alias(params, &["project_id", "id"])?;
            Ok((
                format!(
                    "/api/projects/{}/generate-ai-html",
                    path_segment(&project_id)
                ),
                None,
            ))
        }
        "tmux_analysis.list" => {
            let mut path = "/api/ai/stats".to_string();
            append_i64_query(params, &mut path, "limit", "limit");
            append_string_query(params, &mut path, "project_id", "projectId");
            append_string_query(params, &mut path, "status", "status");
            Ok((path, None))
        }
        "tmux_analysis.cleanup" => {
            let mut path = "/api/ai/stats/cleanup".to_string();
            append_string_query(params, &mut path, "project_id", "projectId");
            Ok((path, None))
        }
        "ai_logs.list" => {
            let mut path = "/api/ai/logs".to_string();
            append_i64_query(params, &mut path, "limit", "limit");
            append_string_query(params, &mut path, "before", "before");
            Ok((path, None))
        }
        "ai_logs.clear" => Ok(("/api/ai/logs".to_string(), None)),
        _ => Err(OmniExecutorError::bad_request(format!(
            "backend route not allowed: {}",
            route.id
        ))),
    }
}

fn insert_optional_string(
    params: &Value,
    body: &mut serde_json::Map<String, Value>,
    input_field: &'static str,
    output_field: &'static str,
) {
    if let Some(value) = optional_string_alias(params, &[input_field, output_field]) {
        body.insert(output_field.to_string(), Value::String(value));
    }
}

fn append_string_query(
    params: &Value,
    path: &mut String,
    input_field: &'static str,
    output_field: &'static str,
) {
    if let Some(value) = optional_string_alias(params, &[input_field, output_field]) {
        append_query(path, output_field, &value);
    }
}

fn append_i64_query(
    params: &Value,
    path: &mut String,
    input_field: &'static str,
    output_field: &'static str,
) {
    if let Some(value) = params.get(input_field).or_else(|| params.get(output_field)) {
        if let Some(number) = value.as_i64() {
            append_query(path, output_field, &number.to_string());
        }
    }
}

fn append_query(path: &mut String, key: &str, value: &str) {
    if path.contains('?') {
        path.push('&');
    } else {
        path.push('?');
    }
    path.push_str(key);
    path.push('=');
    path.push_str(&path_segment(value));
}

fn required_string(params: &Value, field: &'static str) -> Result<String, OmniExecutorError> {
    value_as_string(params.get(field), field)
}

fn required_string_alias(
    params: &Value,
    fields: &[&'static str],
) -> Result<String, OmniExecutorError> {
    fields
        .iter()
        .find_map(|field| value_as_string(params.get(*field), field).ok())
        .ok_or_else(|| OmniExecutorError::bad_request(format!("{} is required", fields[0])))
}

fn optional_string_alias(params: &Value, fields: &[&'static str]) -> Option<String> {
    fields
        .iter()
        .find_map(|field| value_as_string(params.get(*field), field).ok())
}

fn value_as_string(
    value: Option<&Value>,
    field: &'static str,
) -> Result<String, OmniExecutorError> {
    match value {
        Some(Value::String(value)) if !value.trim().is_empty() => Ok(value.trim().to_string()),
        Some(Value::Number(value)) => Ok(value.to_string()),
        _ => Err(OmniExecutorError::bad_request(format!(
            "{field} is required"
        ))),
    }
}

fn required_text(params: &Value, field: &'static str) -> Result<String, OmniExecutorError> {
    match params.get(field) {
        Some(Value::String(value)) if !value.trim().is_empty() => Ok(value.clone()),
        Some(Value::Number(value)) => Ok(value.to_string()),
        _ => Err(OmniExecutorError::bad_request(format!(
            "{field} is required"
        ))),
    }
}

fn bool_param(params: &Value, field: &str) -> bool {
    params.get(field).and_then(Value::as_bool).unwrap_or(false)
}

fn send_to_pane_policy_params(params: &Value) -> Value {
    let mut policy_params = params.clone();
    if let Some(obj) = policy_params.as_object_mut()
        && (optional_string_alias(params, &["control_sequence", "controlSequence"]).is_some()
            || bool_param(params, "control"))
    {
        obj.insert("control".to_string(), Value::Bool(true));
    }
    policy_params
}

fn send_keys_payload(
    text: &str,
    append_enter: bool,
    control: bool,
    control_sequence: Option<&str>,
    multiline: bool,
) -> Result<Vec<String>, OmniExecutorError> {
    let mut keys = Vec::new();
    if let Some(sequence) = control_sequence {
        keys.push(sequence.to_string());
    } else if control {
        keys.push(text.to_string());
    } else if multiline {
        let mut lines = text.split('\n').peekable();
        while let Some(line) = lines.next() {
            if !line.is_empty() {
                keys.push(line.to_string());
            }
            if lines.peek().is_some() {
                keys.push("Enter".to_string());
            }
        }
    } else {
        keys.push(text.to_string());
    }
    if append_enter {
        keys.push("Enter".to_string());
    }
    if keys.is_empty() {
        return Err(OmniExecutorError::bad_request("text is required"));
    }
    Ok(keys)
}

fn pane_matches(pane_info: &crate::tmux::Pane, pane: &str) -> bool {
    pane_info.id == pane || pane_info.index.to_string() == pane
}

fn window_matches(win_info: &crate::tmux::Window, window: &str) -> bool {
    win_info.id == window || win_info.name == window || win_info.index.to_string() == window
}

fn tmux_pane_target(session: &str, window: &str, pane: &str) -> String {
    if pane.starts_with('%') || pane.contains(':') || pane.contains('.') {
        pane.to_string()
    } else {
        let window = exact_tmux_window_segment(window);
        format!("{session}:{window}.{pane}")
    }
}

fn exact_tmux_window_segment(window: &str) -> String {
    if window.starts_with('@')
        || window.starts_with('=')
        || window.starts_with('%')
        || window.contains(':')
        || window.parse::<usize>().is_ok()
    {
        window.to_string()
    } else {
        format!("={window}")
    }
}

fn path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char);
            }
            other => encoded.push_str(format!("%{other:02X}").as_str()),
        }
    }
    encoded
}

fn error_from_response(status: StatusCode, body: Value) -> OmniExecutorError {
    let code = body
        .get("error")
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
        .unwrap_or_else(|| status_error_code(status));
    let message = body
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("request failed")
        .to_string();

    match code {
        "not_found" => OmniExecutorError::not_found(message),
        "conflict" => OmniExecutorError::conflict(message),
        _ => OmniExecutorError::bad_request(message),
    }
}

fn status_error_code(status: StatusCode) -> &'static str {
    match status {
        StatusCode::NOT_FOUND => "not_found",
        StatusCode::CONFLICT => "conflict",
        _ => "bad_request",
    }
}

fn event_requires_confirmation(event: &OmniServerEvent) -> bool {
    matches!(
        event,
        OmniServerEvent::IntentReceived {
            confirmation_required: true,
            ..
        }
    )
}

fn confirmation_error(error: ConfirmationError) -> OmniExecutorError {
    match error {
        ConfirmationError::NotFound(_) => OmniExecutorError::not_found(error.to_string()),
        ConfirmationError::Expired | ConfirmationError::InvalidState => {
            OmniExecutorError::bad_request(error.to_string())
        }
    }
}

fn api_error(error: ApiError) -> OmniExecutorError {
    match error.code() {
        "not_found" => OmniExecutorError::not_found(error.message().to_string()),
        "conflict" => OmniExecutorError::conflict(error.message().to_string()),
        _ => OmniExecutorError::bad_request(error.message().to_string()),
    }
}

fn tmux_error(error: TmuxError) -> OmniExecutorError {
    match error.code() {
        "not_found" => OmniExecutorError::not_found(error.to_string()),
        _ => OmniExecutorError::bad_request(error.to_string()),
    }
}

fn audit_params(skill: &str, params: &Value) -> Value {
    if skill != "send_to_pane" {
        return params.clone();
    }
    let mut audit_params = params.clone();
    if let Some(obj) = audit_params.as_object_mut() {
        if let Some(preview) = text_preview(skill, params) {
            obj.insert("text_preview".to_string(), Value::String(preview));
        }
        obj.remove("text");
        obj.remove("control_sequence");
        obj.remove("controlSequence");
    }
    audit_params
}

fn text_preview(skill: &str, params: &Value) -> Option<String> {
    if skill != "send_to_pane" {
        return None;
    }
    let raw = params
        .get("text")
        .and_then(Value::as_str)
        .or_else(|| params.get("control_sequence").and_then(Value::as_str))
        .or_else(|| params.get("controlSequence").and_then(Value::as_str))?;
    let redacted = redact_secrets(&Value::String(raw.to_string()));
    let text = redacted.as_str().unwrap_or("<redacted>");
    let preview = text.replace('\n', "\\n");
    let truncated = preview.chars().take(80).collect::<String>();
    Some(if truncated.len() < preview.len() {
        format!("{truncated}...")
    } else {
        preview
    })
}

fn audit_target(params: &Value) -> String {
    let params = params.get("params").unwrap_or(params);
    let mut parts = Vec::new();
    for field in [
        "target_name",
        "targetName",
        "session",
        "session_name",
        "sessionName",
        "window",
        "window_name",
        "windowName",
        "pane",
        "pane_index",
        "paneIndex",
    ] {
        if let Some(value) = params.get(field) {
            if let Ok(value) = value_as_string(Some(value), field) {
                parts.push(value);
            }
        }
    }
    if parts.is_empty() {
        "voice".to_string()
    } else {
        parts.join("/")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::logging::LoggingHandle;
    use crate::state::AppState;
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::PathBuf;

    const TOKEN: &str = "executor-token";

    struct TestExecutor {
        executor: OmniSkillExecutor,
        audit_path: PathBuf,
        tmux_log_path: PathBuf,
        _dir: tempfile::TempDir,
    }

    fn test_executor() -> TestExecutor {
        let dir = tempfile::tempdir().expect("tempdir");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");

        let tmux_path = dir.path().join("fake-tmux");
        fs::write(&tmux_path, fake_tmux_script()).expect("write fake tmux");
        make_executable(&tmux_path);

        let audit_path = dir.path().join("audit.log");
        let tmux_log_path = dir.path().join("tmux.log");
        let config_path = dir.path().join("config.jsonc");
        let config = json!({
            "schemaVersion": 1,
            "server": { "bind": "127.0.0.1:0" },
            "auth": { "token": TOKEN },
            "tmux": { "path": tmux_path.to_string_lossy() },
            "connections": [],
            "ui": { "theme": "dark" }
        });
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).expect("serialize config"),
        )
        .expect("write config");
        let store = Config::load(&config_path).expect("load config");
        let state = AppState::new(store, assets_dir, LoggingHandle::empty());
        let executor = OmniSkillExecutor::with_components(
            state,
            ConfirmationState::new(),
            AuditLogger::new(Some(audit_path.clone())),
            "test-actor".to_string(),
        );
        TestExecutor {
            executor,
            audit_path,
            tmux_log_path,
            _dir: dir,
        }
    }

    async fn test_executor_with_storage() -> TestExecutor {
        let mut test = test_executor();
        let db_path = test._dir.path().join("test.db");
        let pool = crate::storage::db::create_pool(&db_path)
            .await
            .expect("create storage pool");
        crate::storage::db::run_migrations(&pool)
            .await
            .expect("run migrations");
        test.executor.state.storage = Some(pool);
        test
    }

    fn confirmation_id(event: OmniServerEvent) -> Uuid {
        match event {
            OmniServerEvent::IntentReceived {
                confirmation_required: true,
                confirmation_id: Some(id),
                ..
            } => Uuid::parse_str(&id).expect("uuid"),
            other => panic!("unexpected event: {other:?}"),
        }
    }

    async fn create_project_fixture(test: &TestExecutor, name: &str) -> String {
        let result = test
            .executor
            .execute(
                "create_project",
                json!({
                    "name": name,
                    "path": "/tmp/wmux-project",
                    "description": "Project fixture"
                }),
            )
            .await
            .expect("create project fixture");
        result.output["data"]["id"]
            .as_str()
            .expect("project id")
            .to_string()
    }

    fn tmux_log(test: &TestExecutor) -> String {
        fs::read_to_string(&test.tmux_log_path).unwrap_or_default()
    }

    fn audit_log(test: &TestExecutor) -> String {
        fs::read_to_string(&test.audit_path).unwrap_or_default()
    }

    fn fake_tmux_script() -> &'static str {
        r#"#!/bin/sh
cmd="$1"
sep=$(printf '\037')
log="$(dirname "$0")/tmux.log"
case "$cmd" in
  -V)
    printf 'tmux 3.4\n'
    ;;
  list-sessions)
    printf '%%1%salpha%s0%s1\n' "$sep" "$sep" "$sep"
    ;;
  has-session)
    if [ "$3" = "missing" ]; then
      printf "can't find session: missing\n" >&2
      exit 1
    fi
    exit 0
    ;;
  new-session)
    name="created"
    previous=""
    for arg in "$@"; do
      if [ "$previous" = "-s" ]; then
        name="$arg"
      fi
      previous="$arg"
    done
    printf '%%2%s%s%s0%s1\n' "$sep" "$name" "$sep" "$sep"
    ;;
  rename-session)
    exit 0
    ;;
  kill-session)
    for arg in "$@"; do
      printf '[%s]' "$arg" >> "$log"
    done
    printf '\n' >> "$log"
    exit 0
    ;;
  list-windows|new-window)
    printf '@1%seditor%s0%s1%s1%s%%1%sshell\n' "$sep" "$sep" "$sep" "$sep" "$sep" "$sep"
    ;;
  kill-window)
    exit 0
    ;;
  list-panes|split-window)
    printf '%%1%stty%s0%s1%s80%s24%s0%s0%s0%s0%s0%s0%szsh\n' "$sep" "$sep" "$sep" "$sep" "$sep" "$sep" "$sep" "$sep" "$sep" "$sep" "$sep" "$sep"
    ;;
  send-keys)
    for arg in "$@"; do
      printf '[%s]' "$arg" >> "$log"
    done
    printf '\n' >> "$log"
    exit 0
    ;;
  clear-history)
    for arg in "$@"; do
      printf '[%s]' "$arg" >> "$log"
    done
    printf '\n' >> "$log"
    exit 0
    ;;
  kill-pane)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
"#
    }

    #[cfg(unix)]
    fn make_executable(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("chmod");
    }

    #[tokio::test]
    async fn executor_navigate_frontend_accepts_allowed_route() {
        let test = test_executor();
        let result = test
            .executor
            .execute("navigate_frontend", json!({ "route": "settings" }))
            .await
            .expect("navigate");

        assert_eq!(
            result.event,
            OmniServerEvent::IntentReceived {
                skill: "navigate_frontend".to_string(),
                params: json!({ "route": "settings" }),
                confirmation_required: false,
                confirmation_id: None,
            }
        );
    }

    #[tokio::test]
    async fn executor_navigate_frontend_rejects_unknown_route() {
        let test = test_executor();
        let error = test
            .executor
            .execute("navigate_frontend", json!({ "route": "/admin" }))
            .await
            .expect_err("invalid route");

        assert_eq!(error.code, "bad_request");
    }

    #[tokio::test]
    async fn executor_new_chat_returns_frontend_intent() {
        let test = test_executor();
        let result = test
            .executor
            .execute("new_chat", json!({}))
            .await
            .expect("new_chat");

        assert_eq!(
            result.event,
            OmniServerEvent::IntentReceived {
                skill: "new_chat".to_string(),
                params: json!({}),
                confirmation_required: false,
                confirmation_id: None,
            }
        );
        assert_eq!(result.output["success"], true);
        assert_eq!(result.output["action"], "new_chat");
    }

    #[tokio::test]
    async fn executor_list_sessions_returns_session_list() {
        let test = test_executor();
        let result = test
            .executor
            .execute("list_sessions", json!({ "target_name": "local" }))
            .await
            .expect("list sessions");

        assert_eq!(result.output["success"], true);
        assert_eq!(result.output["data"]["data"][0]["name"], "alpha");
    }

    #[tokio::test]
    async fn executor_create_and_rename_session_use_existing_handlers() {
        let test = test_executor();

        let created = test
            .executor
            .execute(
                "create_session",
                json!({ "target_name": "local", "session_name": "created" }),
            )
            .await
            .expect("create session");
        assert_eq!(created.output["data"]["data"]["name"], "created");

        let renamed = test
            .executor
            .execute(
                "rename_session",
                json!({ "target_name": "local", "session": "created", "new_name": "renamed" }),
            )
            .await
            .expect("rename session");
        assert_eq!(renamed.output["data"]["operation"], "rename_session");
    }

    #[tokio::test]
    async fn executor_list_sessions_returns_not_found_for_unknown_target() {
        let test = test_executor();
        let error = test
            .executor
            .execute("list_sessions", json!({ "target_name": "missing-target" }))
            .await
            .expect_err("missing target");

        assert_eq!(error.code, "not_found");
    }

    #[tokio::test]
    async fn executor_delete_session_requires_confirmation_then_executes() {
        let test = test_executor();
        let pending = test
            .executor
            .execute(
                "delete_session",
                json!({ "target_name": "local", "session": "alpha" }),
            )
            .await
            .expect("pending delete");

        let confirmation_id = match pending.event {
            OmniServerEvent::IntentReceived {
                confirmation_required: true,
                confirmation_id: Some(id),
                ..
            } => Uuid::parse_str(&id).expect("uuid"),
            other => panic!("unexpected event: {other:?}"),
        };

        let confirmed = test
            .executor
            .execute_confirmed("delete_session", confirmation_id)
            .await
            .expect("confirmed delete");
        assert_eq!(confirmed.output["data"]["operation"], "delete_session");
        assert_eq!(tmux_log(&test), "[kill-session][-t][alpha]\n");
    }

    #[tokio::test]
    async fn executor_delete_session_treats_session_like_target_as_local() {
        let test = test_executor();
        let result = test
            .executor
            .execute_preconfirmed(
                "delete_session",
                json!({ "target_name": "945", "session_name": "945" }),
            )
            .await
            .expect("delete local numeric session");

        assert_eq!(result.output["data"]["operation"], "delete_session");
        assert_eq!(tmux_log(&test), "[kill-session][-t][945]\n");
    }

    #[tokio::test]
    async fn executor_invoke_backend_route_treats_session_like_target_as_local() {
        let test = test_executor();
        let result = test
            .executor
            .execute_preconfirmed(
                "invoke_backend_route",
                json!({
                    "route_id": "sessions.delete",
                    "params": { "target_name": "945", "session_name": "945" }
                }),
            )
            .await
            .expect("delete local numeric session through backend route");

        assert_eq!(result.output["data"]["operation"], "delete_session");
        assert_eq!(tmux_log(&test), "[kill-session][-t][945]\n");
    }

    #[tokio::test]
    async fn send_to_pane_plain_text_targets_exact_pane() {
        let test = test_executor();
        let result = test
            .executor
            .execute(
                "send_to_pane",
                json!({
                    "target_name": "local",
                    "session": "alpha",
                    "window": "editor",
                    "pane": "0",
                    "text": "hello"
                }),
            )
            .await
            .expect("send plain text");

        assert_eq!(result.output["skill"], "send_to_pane");
        assert_eq!(result.output["success"], true);
        assert_eq!(tmux_log(&test), "[send-keys][-t][alpha:=editor.0][hello]\n");
        let audit = audit_log(&test);
        assert!(audit.contains("\"target\":\"local/alpha/editor/0\""));
        assert!(audit.contains("\"transcript_text\":\"hello\""));
    }

    #[tokio::test]
    async fn send_to_pane_command_requires_confirmation_then_sends() {
        let test = test_executor();
        let pending = test
            .executor
            .execute(
                "send_to_pane",
                json!({
                    "target_name": "local",
                    "session": "alpha",
                    "window": "editor",
                    "pane": "0",
                    "text": "cargo test",
                    "append_enter": true
                }),
            )
            .await
            .expect("pending send");
        assert!(tmux_log(&test).is_empty());

        let confirmation_id = match pending.event {
            OmniServerEvent::IntentReceived {
                confirmation_required: true,
                confirmation_id: Some(id),
                ..
            } => Uuid::parse_str(&id).expect("uuid"),
            other => panic!("unexpected event: {other:?}"),
        };

        let confirmed = test
            .executor
            .execute_confirmed("send_to_pane", confirmation_id)
            .await
            .expect("confirmed send");
        assert_eq!(confirmed.output["success"], true);
        assert_eq!(
            tmux_log(&test),
            "[send-keys][-t][alpha:=editor.0][cargo test][Enter]\n"
        );
    }

    #[tokio::test]
    async fn send_to_pane_missing_pane_not_found() {
        let test = test_executor();
        let error = test
            .executor
            .execute(
                "send_to_pane",
                json!({
                    "target_name": "local",
                    "session": "alpha",
                    "window": "editor",
                    "pane": "9",
                    "text": "hello"
                }),
            )
            .await
            .expect_err("missing pane");

        assert_eq!(error.code, "not_found");
        assert!(tmux_log(&test).is_empty());
    }

    #[tokio::test]
    async fn send_to_pane_enter_without_confirm_blocked() {
        let test = test_executor();
        let pending = test
            .executor
            .execute(
                "send_to_pane",
                json!({
                    "target_name": "local",
                    "session": "alpha",
                    "window": "editor",
                    "pane": "0",
                    "text": "ls",
                    "append_enter": true
                }),
            )
            .await
            .expect("pending send");

        assert!(matches!(
            pending.event,
            OmniServerEvent::IntentReceived {
                confirmation_required: true,
                ..
            }
        ));
        assert!(tmux_log(&test).is_empty());
    }

    #[tokio::test]
    async fn executor_confirm_missing_confirmation_returns_not_found() {
        let test = test_executor();
        let error = test
            .executor
            .execute_confirmed("delete_session", Uuid::new_v4())
            .await
            .expect_err("missing confirmation");

        assert_eq!(error.code, "not_found");
    }

    #[tokio::test]
    async fn executor_invoke_backend_route_rejects_invalid_route_id() {
        let test = test_executor();
        let error = test
            .executor
            .execute(
                "invoke_backend_route",
                json!({ "route_id": "config.raw", "params": {} }),
            )
            .await
            .expect_err("invalid route id");

        assert_eq!(error.code, "bad_request");
    }

    #[tokio::test]
    async fn executor_invoke_backend_route_safe_read_executes_directly() {
        let test = test_executor();
        let result = test
            .executor
            .execute(
                "invoke_backend_route",
                json!({ "route_id": "sessions.list", "params": { "target_name": "local" } }),
            )
            .await
            .expect("invoke sessions.list");

        assert_eq!(result.output["data"]["data"][0]["name"], "alpha");
    }

    #[tokio::test]
    async fn executor_invoke_backend_route_write_requires_confirmation() {
        let test = test_executor();
        let result = test
            .executor
            .execute(
                "invoke_backend_route",
                json!({
                    "route_id": "sessions.create",
                    "params": { "target_name": "local", "session_name": "created" }
                }),
            )
            .await
            .expect("pending write route");

        assert!(matches!(
            result.event,
            OmniServerEvent::IntentReceived {
                confirmation_required: true,
                ..
            }
        ));
    }

    // ── New skill tests ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn executor_get_current_focus_returns_intent() {
        let test = test_executor();
        let result = test
            .executor
            .execute("get_current_focus", json!({}))
            .await
            .expect("get_current_focus");

        assert!(matches!(
            result.event,
            OmniServerEvent::IntentReceived {
                confirmation_required: false,
                ..
            }
        ));
        assert_eq!(result.output["success"], true);
    }

    #[tokio::test]
    async fn executor_read_pane_output_returns_content() {
        let test = test_executor();
        let result = test
            .executor
            .execute(
                "read_pane_output",
                json!({
                    "target_name": "local",
                    "session_name": "alpha",
                    "window_name": "editor",
                    "pane_index": "0",
                    "lines": 20
                }),
            )
            .await
            .expect("read pane output");

        assert_eq!(result.output["success"], true);
        assert_eq!(result.output["lines_requested"], 20);
        // fake tmux capture-pane returns empty string
        assert!(result.output["content"].is_string());
    }

    #[tokio::test]
    async fn executor_read_pane_output_missing_pane_returns_not_found() {
        let test = test_executor();
        let error = test
            .executor
            .execute(
                "read_pane_output",
                json!({
                    "target_name": "local",
                    "session_name": "alpha",
                    "window_name": "editor",
                    "pane_index": "99"
                }),
            )
            .await
            .expect_err("missing pane");

        assert_eq!(error.code, "not_found");
    }

    #[tokio::test]
    async fn executor_get_config_returns_config() {
        let test = test_executor();
        let result = test
            .executor
            .execute("get_config", json!({}))
            .await
            .expect("get config");

        assert_eq!(result.output["success"], true);
    }

    #[tokio::test]
    async fn executor_check_health_returns_health() {
        let test = test_executor();
        let result = test
            .executor
            .execute("check_health", json!({}))
            .await
            .expect("check health");

        assert_eq!(result.output["success"], true);
    }

    #[tokio::test]
    async fn executor_create_window_succeeds() {
        let test = test_executor();
        let result = test
            .executor
            .execute(
                "create_window",
                json!({
                    "target_name": "local",
                    "session_name": "alpha",
                    "window_name": "newwin"
                }),
            )
            .await
            .expect("create window");

        assert_eq!(result.output["success"], true);
    }

    #[tokio::test]
    async fn executor_rename_window_succeeds() {
        let test = test_executor();
        let result = test
            .executor
            .execute(
                "rename_window",
                json!({
                    "target_name": "local",
                    "session_name": "alpha",
                    "window_name": "editor",
                    "new_name": "code"
                }),
            )
            .await
            .expect("rename window");

        assert_eq!(result.output["success"], true);
    }

    #[tokio::test]
    async fn executor_split_pane_succeeds() {
        let test = test_executor();
        let result = test
            .executor
            .execute(
                "split_pane",
                json!({
                    "target_name": "local",
                    "session_name": "alpha",
                    "window_name": "editor",
                    "pane_index": "0",
                    "horizontal": false
                }),
            )
            .await
            .expect("split pane");

        assert_eq!(result.output["success"], true);
    }

    #[tokio::test]
    async fn executor_focus_pane_returns_intent() {
        let test = test_executor();
        let result = test
            .executor
            .execute(
                "focus_pane",
                json!({
                    "target_name": "local",
                    "session_name": "alpha",
                    "window_name": "editor",
                    "pane_index": "0"
                }),
            )
            .await
            .expect("focus pane");

        assert!(matches!(
            result.event,
            OmniServerEvent::IntentReceived {
                confirmation_required: false,
                ..
            }
        ));
        if let OmniServerEvent::IntentReceived { params, .. } = &result.event {
            assert_eq!(params["pane_index"], "0");
        }
    }

    #[tokio::test]
    async fn executor_run_project_requires_confirmation_then_sends_commands() {
        let test = test_executor();
        let pending = test
            .executor
            .execute(
                "run_project",
                json!({
                    "target_name": "local",
                    "session_name": "alpha",
                    "window_name": "editor",
                    "pane_index": "0",
                    "project_path": "/home/user/myapp",
                    "start_command": "npm run dev"
                }),
            )
            .await
            .expect("pending run_project");

        assert!(matches!(
            pending.event,
            OmniServerEvent::IntentReceived {
                confirmation_required: true,
                ..
            }
        ));
        assert!(tmux_log(&test).is_empty());

        let confirmation_id = match pending.event {
            OmniServerEvent::IntentReceived {
                confirmation_required: true,
                confirmation_id: Some(id),
                ..
            } => Uuid::parse_str(&id).expect("uuid"),
            other => panic!("unexpected event: {other:?}"),
        };

        let confirmed = test
            .executor
            .execute_confirmed("run_project", confirmation_id)
            .await
            .expect("confirmed run_project");
        assert_eq!(confirmed.output["success"], true);
        let log = tmux_log(&test);
        assert!(log.contains("[cd /home/user/myapp]"));
        assert!(log.contains("[npm run dev]"));
    }

    #[tokio::test]
    async fn executor_delete_window_requires_confirmation_then_deletes() {
        let test = test_executor();
        let pending = test
            .executor
            .execute(
                "delete_window",
                json!({
                    "target_name": "local",
                    "session_name": "alpha",
                    "window_name": "editor"
                }),
            )
            .await
            .expect("pending delete_window");

        assert!(matches!(
            pending.event,
            OmniServerEvent::IntentReceived {
                confirmation_required: true,
                ..
            }
        ));

        let confirmation_id = match pending.event {
            OmniServerEvent::IntentReceived {
                confirmation_id: Some(id),
                ..
            } => Uuid::parse_str(&id).expect("uuid"),
            other => panic!("unexpected event: {other:?}"),
        };

        let confirmed = test
            .executor
            .execute_confirmed("delete_window", confirmation_id)
            .await
            .expect("confirmed delete_window");
        assert_eq!(confirmed.output["success"], true);
    }

    #[tokio::test]
    async fn executor_kill_pane_requires_confirmation_then_kills() {
        let test = test_executor();
        let pending = test
            .executor
            .execute(
                "kill_pane",
                json!({
                    "target_name": "local",
                    "session_name": "alpha",
                    "window_name": "editor",
                    "pane_index": "0"
                }),
            )
            .await
            .expect("pending kill_pane");

        assert!(matches!(
            pending.event,
            OmniServerEvent::IntentReceived {
                confirmation_required: true,
                ..
            }
        ));

        let confirmation_id = match pending.event {
            OmniServerEvent::IntentReceived {
                confirmation_id: Some(id),
                ..
            } => Uuid::parse_str(&id).expect("uuid"),
            other => panic!("unexpected event: {other:?}"),
        };

        let confirmed = test
            .executor
            .execute_confirmed("kill_pane", confirmation_id)
            .await
            .expect("confirmed kill_pane");
        assert_eq!(confirmed.output["success"], true);
    }

    #[tokio::test]
    async fn executor_clear_pane_sends_clear_command() {
        let test = test_executor();
        let result = test
            .executor
            .execute(
                "clear_pane",
                json!({
                    "target_name": "local",
                    "session_name": "alpha",
                    "window_name": "editor",
                    "pane_index": "0"
                }),
            )
            .await
            .expect("clear pane");

        assert_eq!(result.output["success"], true);
        assert_eq!(result.output["skill"], "clear_pane");
        let log = tmux_log(&test);
        assert!(
            log.contains("[clear]"),
            "should have sent clear command, got: {log}"
        );
        assert!(
            log.contains("[clear-history][-t][%1]"),
            "should have cleared tmux scroll history, got: {log}"
        );
    }

    #[tokio::test]
    async fn executor_project_skills_cover_crud_and_lifecycle_routes() {
        let test = test_executor_with_storage().await;

        let listed = test
            .executor
            .execute("list_projects", json!({}))
            .await
            .expect("list projects");
        assert_eq!(listed.output["data"]["data"].as_array().unwrap().len(), 0);

        let created = test
            .executor
            .execute(
                "create_project",
                json!({
                    "name": "voice-project",
                    "path": "/tmp/wmux-project",
                    "description": "Created by voice skill"
                }),
            )
            .await
            .expect("create project");
        let project_id = created.output["data"]["id"]
            .as_str()
            .expect("project id")
            .to_string();
        assert_eq!(created.output["data"]["name"], "voice-project");

        let updated = test
            .executor
            .execute(
                "update_project",
                json!({
                    "project_id": project_id,
                    "description": "Updated by voice skill"
                }),
            )
            .await
            .expect("update project");
        assert_eq!(
            updated.output["data"]["description"],
            "Updated by voice skill"
        );

        let launched = test
            .executor
            .execute("launch_project", json!({ "project_id": project_id }))
            .await
            .expect("launch project");
        assert_eq!(launched.output["data"]["operation"], "sync");

        let synced = test
            .executor
            .execute(
                "sync_project_from_tmux",
                json!({ "project_id": project_id }),
            )
            .await
            .expect("sync project");
        assert_eq!(synced.output["data"]["operation"], "sync");

        let ai_error = test
            .executor
            .execute(
                "generate_project_ai_html",
                json!({ "project_id": project_id }),
            )
            .await
            .expect_err("AI provider is not configured in the test fixture");
        assert_eq!(ai_error.code, "bad_request");

        let pending = test
            .executor
            .execute(
                "delete_project",
                json!({ "project_id": project_id, "kill_session": false }),
            )
            .await
            .expect("pending delete project");
        let confirmed = test
            .executor
            .execute_confirmed("delete_project", confirmation_id(pending.event))
            .await
            .expect("confirmed delete project");
        assert_eq!(confirmed.output["success"], true);
    }

    #[tokio::test]
    async fn executor_analysis_and_log_skills_cover_routes() {
        let test = test_executor_with_storage().await;

        let analyze_error = test
            .executor
            .execute(
                "analyze_session",
                json!({ "target_name": "local", "session_name": "alpha" }),
            )
            .await
            .expect_err("AI intelligence is not configured in the test fixture");
        assert_eq!(analyze_error.code, "bad_request");

        let stats = test
            .executor
            .execute("list_tmux_analysis", json!({ "limit": 10 }))
            .await
            .expect("list tmux analysis");
        assert_eq!(stats.output["data"]["summary"]["totalEvents"], 0);

        let cleanup = test
            .executor
            .execute("cleanup_tmux_analysis", json!({}))
            .await
            .expect("pending cleanup");
        let cleanup_confirmed = test
            .executor
            .execute_confirmed("cleanup_tmux_analysis", confirmation_id(cleanup.event))
            .await
            .expect("confirmed cleanup");
        assert_eq!(cleanup_confirmed.output["data"]["deleted"], 0);

        let logs = test
            .executor
            .execute("list_ai_logs", json!({ "limit": 10 }))
            .await
            .expect("list AI logs");
        assert_eq!(logs.output["data"]["data"].as_array().unwrap().len(), 0);

        let clear = test
            .executor
            .execute("clear_ai_logs", json!({}))
            .await
            .expect("pending clear logs");
        let clear_confirmed = test
            .executor
            .execute_confirmed("clear_ai_logs", confirmation_id(clear.event))
            .await
            .expect("confirmed clear logs");
        assert_eq!(clear_confirmed.output["success"], true);
    }

    #[tokio::test]
    async fn executor_dispatches_every_builtin_skill() {
        let test = test_executor_with_storage().await;
        let project_id = create_project_fixture(&test, "dispatch-project").await;
        let cases = [
            ("navigate_frontend", json!({ "route": "settings" })),
            (
                "invoke_backend_route",
                json!({ "route_id": "connections.list", "params": {} }),
            ),
            ("list_sessions", json!({ "target_name": "local" })),
            (
                "create_session",
                json!({ "target_name": "local", "session_name": "created" }),
            ),
            (
                "rename_session",
                json!({ "target_name": "local", "old_name": "created", "new_name": "renamed" }),
            ),
            (
                "delete_session",
                json!({ "target_name": "local", "session_name": "alpha" }),
            ),
            (
                "send_to_pane",
                json!({ "target_name": "local", "session_name": "alpha", "window_name": "editor", "pane_index": "0", "text": "hello" }),
            ),
            ("new_chat", json!({})),
            ("get_current_focus", json!({})),
            (
                "read_pane_output",
                json!({ "target_name": "local", "session_name": "alpha", "window_name": "editor", "pane_index": "0" }),
            ),
            ("get_config", json!({})),
            ("check_health", json!({})),
            (
                "create_window",
                json!({ "target_name": "local", "session_name": "alpha", "window_name": "newwin" }),
            ),
            (
                "rename_window",
                json!({ "target_name": "local", "session_name": "alpha", "window_name": "editor", "new_name": "code" }),
            ),
            (
                "split_pane",
                json!({ "target_name": "local", "session_name": "alpha", "window_name": "editor", "pane_index": "0" }),
            ),
            (
                "focus_pane",
                json!({ "target_name": "local", "session_name": "alpha", "window_name": "editor", "pane_index": "0" }),
            ),
            (
                "run_project",
                json!({ "target_name": "local", "session_name": "alpha", "window_name": "editor", "pane_index": "0", "project_path": "/tmp/wmux-project", "start_command": "make run" }),
            ),
            ("list_projects", json!({})),
            ("create_project", json!({ "name": "dispatch-project-two" })),
            (
                "update_project",
                json!({ "project_id": project_id, "description": "dispatch update" }),
            ),
            (
                "delete_project",
                json!({ "project_id": project_id, "kill_session": false }),
            ),
            ("launch_project", json!({ "project_id": project_id })),
            (
                "sync_project_from_tmux",
                json!({ "project_id": project_id }),
            ),
            (
                "generate_project_ai_html",
                json!({ "project_id": project_id }),
            ),
            (
                "analyze_session",
                json!({ "target_name": "local", "session_name": "alpha" }),
            ),
            ("list_tmux_analysis", json!({})),
            ("cleanup_tmux_analysis", json!({})),
            ("list_ai_logs", json!({})),
            ("clear_ai_logs", json!({})),
            (
                "delete_window",
                json!({ "target_name": "local", "session_name": "alpha", "window_name": "editor" }),
            ),
            (
                "kill_pane",
                json!({ "target_name": "local", "session_name": "alpha", "window_name": "editor", "pane_index": "0" }),
            ),
            (
                "clear_pane",
                json!({ "target_name": "local", "session_name": "alpha", "window_name": "editor", "pane_index": "0" }),
            ),
        ];

        let dispatch_ids = cases
            .iter()
            .map(|(id, _)| (*id).to_string())
            .chain(
                ["confirm_action", "cancel_action"]
                    .into_iter()
                    .map(str::to_string),
            )
            .collect::<BTreeSet<_>>();
        let builtin_ids = crate::skills::builtin_skill_defs()
            .into_iter()
            .map(|skill| skill.id)
            .collect::<BTreeSet<_>>();
        assert_eq!(dispatch_ids, builtin_ids);

        for (skill, params) in cases {
            let result = test.executor.execute(skill, params).await;
            if let Err(error) = result {
                assert_ne!(
                    error.message,
                    format!("unsupported voice skill: {skill}"),
                    "{skill} should be dispatched by the executor"
                );
            }
        }
    }
}

use axum::Json;
use axum::extract::{FromRequestParts, RawPathParams, State};
use axum::http::request::Parts;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use wmux_core::intelligence::{self, ActiveProvider, SessionIntelligence};
use wmux_core::tmux::{Adapter, Pane, Session, TmuxError, Window};

use crate::handlers::connections::{current_config, find_connection, require_local_connection};
use crate::http::{ApiError, ApiResult};
use crate::state::AppState;

struct TargetContext {
    name: String,
    mode: String,
    adapter: Adapter,
}

pub struct SessionPath {
    target: String,
    session: String,
}

pub struct TargetPath {
    target: String,
}

pub struct WindowPath {
    target: String,
    session: String,
    window: String,
}

pub struct PanePath {
    target: String,
    session: String,
    window: String,
    pane: String,
}

impl<S> FromRequestParts<S> for SessionPath
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let params = RawPathParams::from_request_parts(parts, state)
            .await
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
        Ok(Self {
            target: target_path_param(&params)?,
            session: path_param(&params, "session")?,
        })
    }
}

impl<S> FromRequestParts<S> for TargetPath
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let params = RawPathParams::from_request_parts(parts, state)
            .await
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
        Ok(Self {
            target: target_path_param(&params)?,
        })
    }
}

impl<S> FromRequestParts<S> for WindowPath
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let params = RawPathParams::from_request_parts(parts, state)
            .await
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
        Ok(Self {
            target: target_path_param(&params)?,
            session: path_param(&params, "session")?,
            window: path_param(&params, "window")?,
        })
    }
}

impl<S> FromRequestParts<S> for PanePath
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let params = RawPathParams::from_request_parts(parts, state)
            .await
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
        Ok(Self {
            target: target_path_param(&params)?,
            session: path_param(&params, "session")?,
            window: path_param(&params, "window")?,
            pane: path_param(&params, "pane")?,
        })
    }
}

fn target_path_param(params: &RawPathParams) -> Result<String, ApiError> {
    path_param(params, "target").or_else(|_| path_param(params, "id"))
}

fn path_param(params: &RawPathParams, name: &'static str) -> Result<String, ApiError> {
    params
        .iter()
        .find_map(|(key, value)| (key == name).then(|| value.trim().to_string()))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request(format!("{name} path parameter is required")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsListResponse {
    target_name: String,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Vec<Session>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsListResponse {
    target_name: String,
    session: String,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Vec<Window>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanesListResponse {
    target_name: String,
    session: String,
    window: String,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Vec<Pane>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeSessionResponse {
    target_name: String,
    session: String,
    status: &'static str,
    updated: usize,
    skipped: usize,
    errors: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    intelligence: Option<SessionIntelligence>,
}

#[derive(Deserialize)]
pub struct NamedRequest {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPaneRequest {
    horizontal: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOperationResponse {
    target_name: String,
    operation: &'static str,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Session,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowOperationResponse {
    target_name: String,
    session: String,
    operation: &'static str,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Window,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneOperationResponse {
    target_name: String,
    session: String,
    window: String,
    operation: &'static str,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Pane,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResponse {
    target_name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    session: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    window: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pane: String,
    operation: &'static str,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    status: &'static str,
}

pub async fn list_sessions(
    State(state): State<AppState>,
    target: TargetPath,
) -> ApiResult<SessionsListResponse> {
    let target = target_context(&state, target.target).await?;
    let mut data = target.adapter.list_sessions().await.map_err(session_error)?;
    apply_cached_session_intelligence(&state, target.name.as_str(), &mut data);
    spawn_session_intelligence_refreshes(state.clone(), target.name.clone(), target.adapter.clone(), &data);
    tracing::debug!(target_name = %target.name, "listed tmux sessions");
    Ok(Json(SessionsListResponse {
        target_name: target.name,
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        data,
    }))
}

pub async fn create_session(
    State(state): State<AppState>,
    target: TargetPath,
    Json(payload): Json<NamedRequest>,
) -> Result<(StatusCode, Json<SessionOperationResponse>), ApiError> {
    let target = target_context(&state, target.target).await?;
    let data = target
        .adapter
        .new_session(payload.name.trim())
        .await
        .map_err(session_error)?;
    tracing::info!(target_name = %target.name, session = %payload.name, "session created");
    Ok((
        StatusCode::CREATED,
        Json(SessionOperationResponse {
            target_name: target.name,
            operation: "create_session",
            mode: target.mode,
            adapter_path: target.adapter.path().to_string(),
            data,
        }),
    ))
}

pub async fn analyze_session(
    State(state): State<AppState>,
    path: SessionPath,
) -> ApiResult<AnalyzeSessionResponse> {
    let target = target_context(&state, path.target).await?;
    let session = path.session;
    require_session(&target.adapter, &session).await?;
    let config = current_config(&state)?;
    let Some(provider) = intelligence::active_provider(&config) else {
        return Err(ApiError::bad_request(
            "AI intelligence is disabled or not configured",
        ));
    };

    let result = analyze_session_text(
        &target.adapter,
        &provider,
        &session,
        config.intelligence.max_bytes,
        Duration::from_secs(config.intelligence.timeout_sec as u64),
        state.storage.as_ref(),
        target.name.as_str(),
        session.as_str(),
    )
    .await;

    let (intelligence, errors) = match result {
        Ok(intelligence) => (intelligence, 0),
        Err(message) => (intelligence::error_result(Some(&provider), message), 1),
    };
    state
        .intelligence
        .set(target.name.as_str(), session.as_str(), intelligence.clone());

    Ok(Json(AnalyzeSessionResponse {
        target_name: target.name,
        session,
        status: if errors == 0 { "ok" } else { "error" },
        updated: 1,
        skipped: 0,
        errors,
        intelligence: Some(intelligence),
    }))
}

pub async fn list_windows(
    State(state): State<AppState>,
    path: SessionPath,
) -> ApiResult<WindowsListResponse> {
    let target = target_context(&state, path.target).await?;
    let session = path.session;
    require_session(&target.adapter, &session).await?;
    let data = target
        .adapter
        .list_windows(&session)
        .await
        .map_err(session_error)?;
    Ok(Json(WindowsListResponse {
        target_name: target.name,
        session,
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        data,
    }))
}

pub async fn create_window(
    State(state): State<AppState>,
    path: SessionPath,
    Json(payload): Json<NamedRequest>,
) -> Result<(StatusCode, Json<WindowOperationResponse>), ApiError> {
    let target = target_context(&state, path.target).await?;
    let session = path.session;
    require_session(&target.adapter, &session).await?;
    let data = target
        .adapter
        .new_window(&session, payload.name.trim())
        .await
        .map_err(session_error)?;
    tracing::info!(target_name = %target.name, session = %session, window = %payload.name, "window created");
    Ok((
        StatusCode::CREATED,
        Json(WindowOperationResponse {
            target_name: target.name,
            session,
            operation: "create_window",
            mode: target.mode,
            adapter_path: target.adapter.path().to_string(),
            data,
        }),
    ))
}

pub async fn list_panes(
    State(state): State<AppState>,
    path: WindowPath,
) -> ApiResult<PanesListResponse> {
    let target = target_context(&state, path.target).await?;
    let session = path.session;
    let window = path.window;
    require_session(&target.adapter, &session).await?;
    let data = target
        .adapter
        .list_panes(&session, &window)
        .await
        .map_err(session_error)?;
    Ok(Json(PanesListResponse {
        target_name: target.name,
        session,
        window,
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        data,
    }))
}

pub async fn delete_session(
    State(state): State<AppState>,
    path: SessionPath,
) -> ApiResult<OperationResponse> {
    write_session_operation(
        state,
        path.target,
        path.session,
        String::new(),
        String::new(),
        "delete_session",
    )
    .await
}

pub async fn rename_session(
    State(state): State<AppState>,
    path: SessionPath,
    Json(payload): Json<NamedRequest>,
) -> ApiResult<OperationResponse> {
    let target = target_context(&state, path.target).await?;
    let session = path.session;
    require_session(&target.adapter, &session).await?;
    target
        .adapter
        .rename_session(&session, payload.name.trim())
        .await
        .map_err(session_error)?;
    tracing::info!(target_name = %target.name, session = %session, new_name = %payload.name, "session renamed");
    Ok(Json(OperationResponse {
        target_name: target.name,
        session,
        window: String::new(),
        pane: String::new(),
        operation: "rename_session",
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        status: "accepted",
    }))
}

pub async fn delete_window(
    State(state): State<AppState>,
    path: WindowPath,
) -> ApiResult<OperationResponse> {
    write_session_operation(state, path.target, path.session, path.window, String::new(), "delete_window").await
}

pub async fn split_pane(
    State(state): State<AppState>,
    path: PanePath,
    Json(payload): Json<SplitPaneRequest>,
) -> Result<(StatusCode, Json<PaneOperationResponse>), ApiError> {
    let target = target_context(&state, path.target).await?;
    let session = path.session;
    let window = path.window;
    let pane = path.pane;
    require_session(&target.adapter, &session).await?;
    let pane_target = build_pane_target(&session, &window, &pane);
    let data = target
        .adapter
        .split_window(&pane_target, payload.horizontal)
        .await
        .map_err(session_error)?;
    tracing::info!(target_name = %target.name, session = %session, window = %window, pane = %pane, "pane split");
    Ok((
        StatusCode::CREATED,
        Json(PaneOperationResponse {
            target_name: target.name,
            session,
            window,
            operation: "split_pane",
            mode: target.mode,
            adapter_path: target.adapter.path().to_string(),
            data,
        }),
    ))
}

pub async fn delete_pane(
    State(state): State<AppState>,
    path: PanePath,
) -> ApiResult<OperationResponse> {
    write_session_operation(state, path.target, path.session, path.window, path.pane, "delete_pane").await
}

async fn write_session_operation(
    state: AppState,
    target_name: String,
    session: String,
    window: String,
    pane: String,
    operation: &'static str,
) -> ApiResult<OperationResponse> {
    let target = target_context(&state, target_name).await?;
    require_session(&target.adapter, &session).await?;

    match operation {
        "delete_session" => target.adapter.kill_session(&session).await,
        "delete_window" => {
            target
                .adapter
                .kill_window(&build_window_target(&session, &window))
                .await
        }
        "delete_pane" => {
            target
                .adapter
                .kill_pane(&build_pane_target(&session, &window, &pane))
                .await
        }
        _ => Err(TmuxError::InvalidInput { field: "operation" }),
    }
    .map_err(session_error)?;

    tracing::info!(target_name = %target.name, session = %session, %operation, "session operation accepted");

    Ok(Json(OperationResponse {
        target_name: target.name,
        session,
        window,
        pane,
        operation,
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        status: "accepted",
    }))
}

fn adapter(state: &AppState) -> Result<Adapter, ApiError> {
    Ok(Adapter::new(current_config(state)?.tmux.path))
}

async fn target_context(state: &AppState, target_name: String) -> Result<TargetContext, ApiError> {
    if target_name == "local" {
        return Ok(TargetContext {
            name: target_name,
            mode: "local".to_string(),
            adapter: adapter(state)?,
        });
    }

    let connection = find_connection(state, target_name.as_str())?;
    require_local_connection(&connection)?;
    Ok(TargetContext {
        name: connection.id,
        mode: connection.connection_type,
        adapter: adapter(state)?,
    })
}

async fn require_session(adapter: &Adapter, session: &str) -> Result<(), ApiError> {
    if adapter.has_session(session).await.map_err(session_error)? {
        Ok(())
    } else {
        Err(ApiError::not_found(format!("session not found: {session}")))
    }
}

fn session_error(error: TmuxError) -> ApiError {
    match error {
        TmuxError::TmuxNotFound { .. }
        | TmuxError::NoSessions
        | TmuxError::TargetNotFound { .. } => ApiError::not_found(error.to_string()),
        TmuxError::CommandFailed { .. }
        | TmuxError::InvalidInput { .. }
        | TmuxError::Parse { .. } => ApiError::bad_request(error.to_string()),
    }
}

fn build_window_target(session: &str, window: &str) -> String {
    format!("{session}:{window}")
}

fn build_pane_target(session: &str, window: &str, pane: &str) -> String {
    format!("{}.{pane}", build_window_target(session, window))
}

fn apply_cached_session_intelligence(
    state: &AppState,
    target_name: &str,
    sessions: &mut [Session],
) {
    let Ok(config) = current_config(state) else {
        return;
    };
    if intelligence::active_provider(&config).is_none() {
        return;
    }

    let cache_ttl = Duration::from_secs(config.intelligence.cache_ttl_sec as u64);

    for session in sessions {
        if let Some(result) =
            state
                .intelligence
                .get(target_name, session.name.as_str(), cache_ttl)
        {
            apply_session_intelligence(session, &result);
        }
    }
}

fn spawn_session_intelligence_refreshes(
    state: AppState,
    target_name: String,
    adapter: Adapter,
    sessions: &[Session],
) {
    let Ok(config) = current_config(&state) else {
        return;
    };
    let Some(provider) = intelligence::active_provider(&config) else {
        return;
    };

    let min_interval = Duration::from_secs(config.intelligence.min_session_interval_sec as u64);
    let timeout = Duration::from_secs(config.intelligence.timeout_sec as u64);
    let max_bytes = config.intelligence.max_bytes;
    let max_concurrency = config.intelligence.max_concurrency as usize;

    for session_name in sessions.iter().map(|session| session.name.clone()) {
        if !state.intelligence.begin_analyze(
            target_name.as_str(),
            session_name.as_str(),
            min_interval,
            max_concurrency,
        ) {
            continue;
        }

        let state = state.clone();
        let adapter = adapter.clone();
        let provider = provider.clone();
        let target_name = target_name.clone();
        let cache_session_name = session_name.clone();

        tokio::spawn(async move {
            let result = analyze_session_text(
                &adapter,
                &provider,
                session_name.as_str(),
                max_bytes,
                timeout,
                state.storage.as_ref(),
                target_name.as_str(),
                cache_session_name.as_str(),
            )
            .await
            .unwrap_or_else(|message| intelligence::error_result(Some(&provider), message));

            state
                .intelligence
                .set(target_name.as_str(), cache_session_name.as_str(), result);
        });
    }
}

async fn analyze_session_text(
    adapter: &Adapter,
    provider: &ActiveProvider,
    session: &str,
    max_bytes: u32,
    timeout: Duration,
    pool: Option<&sqlx::SqlitePool>,
    target_name: &str,
    session_name: &str,
) -> Result<SessionIntelligence, String> {
    let transcript = session_transcript(adapter, session, max_bytes)
        .await
        .map_err(|err| err.to_string())?;

    let start = std::time::Instant::now();
    let result = intelligence::analyze_text(provider, transcript.as_str(), timeout).await;
    let elapsed_ms = start.elapsed().as_millis() as i64;

    // Record AI usage event only when analyze_text was actually called
    if let Some(pool) = pool {
        let pool = pool.clone();
        let provider_name = provider.provider.clone();
        let model_name = provider.model.clone();
        let target = target_name.to_string();
        let sess = session_name.to_string();
        let is_error = result.is_err();
        let error_msg = result.as_ref().err().cloned();

        tokio::spawn(async move {
            let repo = wmux_core::storage::AiUsageRepository::new(pool);
            let event = wmux_core::storage::models::NewAiUsageEvent {
                project_id: None,
                provider: provider_name,
                model: model_name,
                target_name: target,
                session_name: sess,
                status: if is_error { "error".to_string() } else { "success".to_string() },
                duration_ms: elapsed_ms,
                prompt_tokens: None,
                completion_tokens: None,
                total_tokens: None,
                estimated_cost: None,
                error_message: error_msg,
            };
            if let Err(err) = repo.insert(&event).await {
                tracing::error!(raw_error = %err, "failed to record AI usage event");
            }
        });
    }

    result
}

async fn session_transcript(
    adapter: &Adapter,
    session: &str,
    max_bytes: u32,
) -> Result<String, TmuxError> {
    let windows = adapter.list_windows(session).await?;
    let mut transcript = String::new();
    transcript.push_str(&format!("session: {session}\n"));

    let mut remaining = max_bytes as usize;
    for window in windows {
        if remaining == 0 {
            break;
        }
        transcript.push_str(&format!(
            "\nwindow {} {} active={}\n",
            window.index, window.name, window.active
        ));
        let panes = adapter.list_panes(session, window.id.as_str()).await?;
        for pane in panes {
            if remaining == 0 {
                break;
            }
            transcript.push_str(&format!(
                "\npane {} title={} command={} active={}\n",
                pane.index, pane.title, pane.current_command, pane.active
            ));
            let capture = adapter
                .capture_pane(pane.id.as_str(), remaining.min(max_bytes as usize) as u32)
                .await
                .unwrap_or_default();
            remaining = remaining.saturating_sub(capture.len());
            transcript.push_str(capture.as_str());
            transcript.push('\n');
        }
    }

    Ok(transcript)
}

fn apply_session_intelligence(session: &mut Session, intelligence: &SessionIntelligence) {
    session.intelligence_app = Some(intelligence.app.clone());
    session.intelligence_status = Some(intelligence.status.clone());
    session.intelligence_summary = Some(intelligence.summary.clone());
    session.intelligence_source = Some(intelligence.source.clone());
    session.intelligence_confidence = Some(intelligence.confidence);
    session.intelligence_stale = Some(intelligence.stale);
    session.intelligence_updated_at = Some(intelligence.updated_at.clone());
    session.intelligence_error = intelligence.error.clone();
    session.intelligence_app_counts = intelligence.app_counts.clone();
}

use axum::Json;
use axum::extract::{FromRequestParts, RawPathParams, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use wmux_core::intelligence::{
    self, ActiveProvider, CommandClass, IntelligenceStore, SessionIntelligence, WindowCacheDecision,
};
use wmux_core::tmux::{Adapter, Pane, Session, TmuxError, Window};

use crate::handlers::connections::{current_config, find_connection, require_local_connection};
use crate::http::{ApiError, ApiResult};
use crate::state::AppState;

const WINDOW_AI_TRANSCRIPT_MAX_BYTES: u32 = 20_000;

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
    let mut data = target
        .adapter
        .list_sessions()
        .await
        .map_err(session_error)?;
    apply_cached_session_intelligence(&state, target.name.as_str(), &mut data);
    spawn_session_intelligence_refreshes(
        state.clone(),
        target.name.clone(),
        target.adapter.clone(),
        &data,
    );
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

    let min_interval = Duration::from_secs(config.intelligence.min_session_interval_sec as u64);
    let timeout = Duration::from_secs(config.intelligence.timeout_sec as u64);
    let max_bytes = effective_window_ai_max_bytes(config.intelligence.max_bytes);
    let max_concurrency = config.intelligence.max_concurrency as usize;

    let windows = target
        .adapter
        .list_windows(&session)
        .await
        .map_err(session_error)?;

    let mut window_results: Vec<WindowAnalysisResult> = Vec::new();
    for window in &windows {
        let result = analyze_single_window(
            &target.adapter,
            &provider,
            &session,
            window,
            max_bytes,
            timeout,
            state.storage.as_ref(),
            &target.name,
            &state.intelligence,
            min_interval,
            max_concurrency,
        )
        .await;
        window_results.push(result);
    }

    let aggregated = aggregate_window_results(&window_results, &provider);
    state
        .intelligence
        .set(&target.name, &session, aggregated.clone());

    let updated = window_results.iter().filter(|r| r.provider_called).count();
    let skipped = window_results
        .iter()
        .filter(|r| !r.provider_called && !r.is_error)
        .count();
    let errors = window_results.iter().filter(|r| r.is_error).count();

    Ok(Json(AnalyzeSessionResponse {
        target_name: target.name,
        session,
        status: if errors == 0 { "ok" } else { "error" },
        updated,
        skipped,
        errors,
        intelligence: Some(aggregated),
    }))
}

pub async fn list_windows(
    State(state): State<AppState>,
    path: SessionPath,
) -> ApiResult<WindowsListResponse> {
    let target = target_context(&state, path.target).await?;
    let session = path.session;
    require_session(&target.adapter, &session).await?;
    let mut data = target
        .adapter
        .list_windows(&session)
        .await
        .map_err(session_error)?;
    apply_cached_window_intelligence(&state, target.name.as_str(), session.as_str(), &mut data);
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
    write_session_operation(
        state,
        path.target,
        path.session,
        path.window,
        String::new(),
        "delete_window",
    )
    .await
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
    write_session_operation(
        state,
        path.target,
        path.session,
        path.window,
        path.pane,
        "delete_pane",
    )
    .await
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
        if let Some(result) = state
            .intelligence
            .get(target_name, session.name.as_str(), cache_ttl)
        {
            apply_session_intelligence(session, &result);
        }
    }
}

fn apply_cached_window_intelligence(
    state: &AppState,
    target_name: &str,
    session_name: &str,
    windows: &mut [Window],
) {
    let Ok(config) = current_config(state) else {
        return;
    };
    if intelligence::active_provider(&config).is_none() {
        return;
    }

    let cache_ttl = Duration::from_secs(config.intelligence.cache_ttl_sec as u64);

    for window in windows {
        if let Some((result, _, _, _, _)) =
            state
                .intelligence
                .get_window(target_name, session_name, window.id.as_str(), cache_ttl)
        {
            apply_window_intelligence(window, &result);
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
    let max_bytes = effective_window_ai_max_bytes(config.intelligence.max_bytes);
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
        let session_name_clone = session_name.clone();

        tokio::spawn(async move {
            let windows = adapter.list_windows(&session_name_clone).await;

            let window_results: Vec<WindowAnalysisResult> = match windows {
                Ok(windows) => {
                    let mut results = Vec::new();
                    for window in windows {
                        let result = analyze_single_window(
                            &adapter,
                            &provider,
                            &session_name_clone,
                            &window,
                            max_bytes,
                            timeout,
                            state.storage.as_ref(),
                            &target_name,
                            &state.intelligence,
                            min_interval,
                            max_concurrency,
                        )
                        .await;
                        results.push(result);
                    }
                    results
                }
                Err(err) => {
                    vec![WindowAnalysisResult {
                        intelligence: intelligence::error_result(Some(&provider), err.to_string()),
                        provider_called: false,
                        is_error: true,
                    }]
                }
            };

            let aggregated = aggregate_window_results(&window_results, &provider);
            state
                .intelligence
                .set(&target_name, &session_name_clone, aggregated);
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
    let (transcript, active_window) = session_transcript(adapter, session, max_bytes)
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
        let error_msg = result.as_ref().err().map(|e| e.message.clone());
        let window_number = active_window.map(|w| w as i64);
        let response_json = result
            .as_ref()
            .ok()
            .and_then(|r| r.raw_response.clone())
            .or_else(|| result.as_ref().err().and_then(|e| e.raw_response.clone()));
        let prompt_tokens = result.as_ref().ok().and_then(|r| r.prompt_tokens);
        let completion_tokens = result.as_ref().ok().and_then(|r| r.completion_tokens);
        let total_tokens = result.as_ref().ok().and_then(|r| r.total_tokens);

        tokio::spawn(async move {
            let repo = wmux_core::storage::AiUsageRepository::new(pool);
            let event = wmux_core::storage::models::NewAiUsageEvent {
                project_id: None,
                provider: provider_name,
                model: model_name,
                target_name: target,
                session_name: sess,
                status: if is_error {
                    "error".to_string()
                } else {
                    "success".to_string()
                },
                duration_ms: elapsed_ms,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                estimated_cost: None,
                error_message: error_msg,
                window_number,
                response_json,
            };
            if let Err(err) = repo.insert(&event).await {
                tracing::error!(raw_error = %err, "failed to record AI usage event");
            }
        });
    }

    result.map(|r| r.intelligence).map_err(|e| e.message)
}

async fn session_transcript(
    adapter: &Adapter,
    session: &str,
    max_bytes: u32,
) -> Result<(String, Option<usize>), TmuxError> {
    let windows = adapter.list_windows(session).await?;
    let mut transcript = String::new();
    transcript.push_str(&format!("session: {session}\n"));
    let active_window = windows.iter().find(|w| w.active).map(|w| w.index);

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

    Ok((transcript, active_window))
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

fn apply_window_intelligence(window: &mut Window, intelligence: &SessionIntelligence) {
    window.intelligence_app = Some(intelligence.app.clone());
    window.intelligence_status = Some(intelligence.status.clone());
    window.intelligence_summary = Some(intelligence.summary.clone());
    window.intelligence_source = Some(intelligence.source.clone());
    window.intelligence_confidence = Some(intelligence.confidence);
    window.intelligence_stale = Some(intelligence.stale);
    window.intelligence_updated_at = Some(intelligence.updated_at.clone());
    window.intelligence_error = intelligence.error.clone();
    window.intelligence_app_counts = intelligence.app_counts.clone();
}

/// Result of analyzing a single window, including whether the provider was actually called.
#[derive(Debug)]
struct WindowAnalysisResult {
    intelligence: SessionIntelligence,
    provider_called: bool,
    is_error: bool,
}

/// Analyzes a single window and returns intelligence with cache decision info.
async fn analyze_single_window(
    adapter: &Adapter,
    provider: &ActiveProvider,
    session_name: &str,
    window: &Window,
    max_bytes: u32,
    timeout: Duration,
    pool: Option<&sqlx::SqlitePool>,
    target_name: &str,
    intelligence_store: &IntelligenceStore,
    min_interval: Duration,
    max_concurrency: usize,
) -> WindowAnalysisResult {
    let panes = match adapter.list_panes(session_name, window.id.as_str()).await {
        Ok(panes) => panes,
        Err(err) => {
            return WindowAnalysisResult {
                intelligence: intelligence::error_result(Some(provider), err.to_string()),
                provider_called: false,
                is_error: true,
            };
        }
    };

    if panes.is_empty() {
        return WindowAnalysisResult {
            intelligence: intelligence::error_result(Some(provider), "no panes in window"),
            provider_called: false,
            is_error: true,
        };
    }

    let pane_signature_data: Vec<(String, usize, String)> = panes
        .iter()
        .map(|pane| {
            let basename = classify_command_basename(&pane.current_command);
            (pane.id.clone(), pane.index, basename)
        })
        .collect();
    let pane_signature = intelligence::compute_pane_signature(&pane_signature_data);

    let active_pane = panes.iter().find(|p| p.active).or_else(|| panes.first());
    let command_class = active_pane
        .map(|p| intelligence::classify_command(&p.current_command))
        .unwrap_or(CommandClass::Unknown);
    let command_basename = active_pane
        .map(|p| classify_command_basename(&p.current_command))
        .unwrap_or_default();

    let max_bytes = effective_window_ai_max_bytes(max_bytes);
    let mut remaining = max_bytes as usize;
    let mut pane_contents: Vec<(usize, String)> = Vec::new();
    for pane in &panes {
        if remaining == 0 {
            break;
        }
        if let Ok(content) = adapter
            .capture_pane(pane.id.as_str(), remaining.min(max_bytes as usize) as u32)
            .await
        {
            remaining = remaining.saturating_sub(content.len());
            pane_contents.push((pane.index, content));
        }
    }

    let content_hash_data: Vec<(usize, &str)> = pane_contents
        .iter()
        .map(|(idx, content)| (*idx, content.as_str()))
        .collect();
    let content_hash = intelligence::hash_window_panes(&content_hash_data);

    let decision = intelligence_store.begin_analyze_window(
        target_name,
        session_name,
        window.id.as_str(),
        &content_hash,
        command_class,
        &command_basename,
        &pane_signature,
        min_interval,
        max_concurrency,
    );

    match decision {
        WindowCacheDecision::Proceed => {
            let transcript = truncate_utf8_bytes(
                &build_window_transcript(session_name, window, &panes, &pane_contents),
                max_bytes as usize,
            );

            let start = std::time::Instant::now();
            let result = intelligence::analyze_text(provider, transcript.as_str(), timeout).await;
            let elapsed_ms = start.elapsed().as_millis() as i64;

            let (intelligence, is_error) = match &result {
                Ok(analysis) => (analysis.intelligence.clone(), false),
                Err(err) => (
                    intelligence::error_result(Some(provider), err.message.clone()),
                    true,
                ),
            };

            if let Some(pool) = pool {
                record_ai_usage_event(
                    pool,
                    provider,
                    target_name,
                    session_name,
                    window.index as i64,
                    elapsed_ms,
                    &result,
                );
            }

            intelligence_store.set_window(
                target_name,
                session_name,
                window.id.as_str(),
                intelligence.clone(),
                &content_hash,
                command_class,
                &command_basename,
                &pane_signature,
            );

            WindowAnalysisResult {
                intelligence,
                provider_called: true,
                is_error,
            }
        }
        WindowCacheDecision::SkipUnchanged(cached) | WindowCacheDecision::SkipBlocked(cached) => {
            WindowAnalysisResult {
                intelligence: cached,
                provider_called: false,
                is_error: false,
            }
        }
        WindowCacheDecision::InFlight => WindowAnalysisResult {
            intelligence: SessionIntelligence {
                app: "unknown".to_string(),
                status: "none".to_string(),
                summary: "Analysis in progress".to_string(),
                source: provider.source(),
                confidence: 0.0,
                stale: true,
                updated_at: intelligence::now_rfc3339(),
                error: None,
                app_counts: None,
            },
            provider_called: false,
            is_error: false,
        },
    }
}

/// Extracts the basename from a command string (last '/' segment, lowercased).
fn classify_command_basename(command: &str) -> String {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let basename = trimmed
        .rfind('/')
        .map_or(trimmed, |pos| &trimmed[pos + 1..]);
    basename.to_ascii_lowercase()
}

fn effective_window_ai_max_bytes(configured_max_bytes: u32) -> u32 {
    if configured_max_bytes == 0 {
        WINDOW_AI_TRANSCRIPT_MAX_BYTES
    } else {
        configured_max_bytes.min(WINDOW_AI_TRANSCRIPT_MAX_BYTES)
    }
}

fn truncate_utf8_bytes(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }

    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

/// Builds a transcript string for a single window.
fn build_window_transcript(
    session_name: &str,
    window: &Window,
    panes: &[Pane],
    pane_contents: &[(usize, String)],
) -> String {
    let mut transcript = String::new();
    transcript.push_str(&format!("session: {session_name}\n"));
    transcript.push_str(&format!(
        "\nwindow {} {} active={}\n",
        window.index, window.name, window.active
    ));

    for pane in panes {
        transcript.push_str(&format!(
            "\npane {} title={} command={} active={}\n",
            pane.index, pane.title, pane.current_command, pane.active
        ));
        if let Some((_, content)) = pane_contents.iter().find(|(idx, _)| *idx == pane.index) {
            transcript.push_str(content);
            transcript.push('\n');
        }
    }

    transcript
}

/// Records an AI usage event to the database.
fn record_ai_usage_event(
    pool: &sqlx::SqlitePool,
    provider: &ActiveProvider,
    target_name: &str,
    session_name: &str,
    window_number: i64,
    elapsed_ms: i64,
    result: &Result<intelligence::AnalysisResult, intelligence::AiProviderError>,
) {
    let pool = pool.clone();
    let provider_name = provider.provider.clone();
    let model_name = provider.model.clone();
    let target = target_name.to_string();
    let sess = session_name.to_string();
    let is_error = result.is_err();
    let error_msg = result.as_ref().err().map(|e| e.message.clone());
    let response_json = result
        .as_ref()
        .ok()
        .and_then(|r| r.raw_response.clone())
        .or_else(|| result.as_ref().err().and_then(|e| e.raw_response.clone()));
    let prompt_tokens = result.as_ref().ok().and_then(|r| r.prompt_tokens);
    let completion_tokens = result.as_ref().ok().and_then(|r| r.completion_tokens);
    let total_tokens = result.as_ref().ok().and_then(|r| r.total_tokens);

    tokio::spawn(async move {
        let repo = wmux_core::storage::AiUsageRepository::new(pool);
        let event = wmux_core::storage::models::NewAiUsageEvent {
            project_id: None,
            provider: provider_name,
            model: model_name,
            target_name: target,
            session_name: sess,
            status: if is_error {
                "error".to_string()
            } else {
                "success".to_string()
            },
            duration_ms: elapsed_ms,
            prompt_tokens,
            completion_tokens,
            total_tokens,
            estimated_cost: None,
            error_message: error_msg,
            window_number: Some(window_number),
            response_json,
        };
        if let Err(err) = repo.insert(&event).await {
            tracing::error!(raw_error = %err, "failed to record AI usage event");
        }
    });
}

/// Aggregates window-level intelligence results into a session-level result.
fn aggregate_window_results(
    results: &[WindowAnalysisResult],
    provider: &ActiveProvider,
) -> SessionIntelligence {
    if results.is_empty() {
        return intelligence::error_result(Some(provider), "no windows analyzed");
    }

    fn status_priority(status: &str) -> u8 {
        match status {
            "blocked" => 7,
            "dead_loop" => 6,
            "waiting_confirm" => 5,
            "waiting" => 4,
            "running" => 3,
            "waiting_idle" => 2,
            "none" => 1,
            _ => 0,
        }
    }

    let highest = results
        .iter()
        .max_by_key(|r| status_priority(&r.intelligence.status))
        .expect("results is non-empty");

    let mut app_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for result in results {
        if let Some(counts) = &result.intelligence.app_counts {
            for (app, count) in counts {
                *app_counts.entry(app.clone()).or_insert(0) += *count;
            }
        }
    }

    let max_confidence = results
        .iter()
        .fold(0.0_f32, |acc, r| acc.max(r.intelligence.confidence));

    let any_stale = results.iter().any(|r| r.intelligence.stale);

    let error = results.iter().find_map(|r| r.intelligence.error.clone());

    SessionIntelligence {
        app: highest.intelligence.app.clone(),
        status: highest.intelligence.status.clone(),
        summary: highest.intelligence.summary.clone(),
        source: provider.source(),
        confidence: max_confidence,
        stale: any_stale,
        updated_at: intelligence::now_rfc3339(),
        error,
        app_counts: if app_counts.is_empty() {
            None
        } else {
            Some(app_counts)
        },
    }
}

#[cfg(test)]
mod aggregate_tests {
    use super::*;
    use std::collections::HashMap;

    fn make_provider() -> ActiveProvider {
        ActiveProvider {
            name: "test".to_string(),
            provider: "openai".to_string(),
            model: "gpt-4".to_string(),
            api_key: "key".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
        }
    }

    fn make_result(
        status: &str,
        app_counts: Option<HashMap<String, usize>>,
    ) -> WindowAnalysisResult {
        WindowAnalysisResult {
            intelligence: SessionIntelligence {
                app: "test".to_string(),
                status: status.to_string(),
                summary: "test".to_string(),
                source: "test".to_string(),
                confidence: 0.5,
                stale: false,
                updated_at: intelligence::now_rfc3339(),
                error: None,
                app_counts,
            },
            provider_called: false,
            is_error: false,
        }
    }

    #[test]
    fn window_ai_max_bytes_is_capped_at_20k() {
        assert_eq!(effective_window_ai_max_bytes(24_000), 20_000);
        assert_eq!(effective_window_ai_max_bytes(20_000), 20_000);
        assert_eq!(effective_window_ai_max_bytes(4_096), 4_096);
        assert_eq!(effective_window_ai_max_bytes(0), 20_000);
    }

    #[test]
    fn truncate_utf8_bytes_respects_char_boundaries() {
        assert_eq!(truncate_utf8_bytes("abcdef", 3), "abc");
        assert_eq!(truncate_utf8_bytes("你好吗", 4), "你");
        assert_eq!(truncate_utf8_bytes("short", 10), "short");
    }

    #[test]
    fn test_aggregate_status_priority() {
        let provider = make_provider();

        let results = vec![
            make_result("none", None),
            make_result("running", None),
            make_result("blocked", None),
            make_result("waiting", None),
        ];

        let aggregated = aggregate_window_results(&results, &provider);
        assert_eq!(aggregated.status, "blocked");
    }

    #[test]
    fn test_aggregate_app_counts_sum() {
        let provider = make_provider();

        let mut counts1 = HashMap::new();
        counts1.insert("vim".to_string(), 2);
        counts1.insert("git".to_string(), 1);

        let mut counts2 = HashMap::new();
        counts2.insert("vim".to_string(), 3);
        counts2.insert("cargo".to_string(), 1);

        let results = vec![
            make_result("running", Some(counts1)),
            make_result("waiting", Some(counts2)),
        ];

        let aggregated = aggregate_window_results(&results, &provider);
        let app_counts = aggregated.app_counts.expect("app_counts should be present");
        assert_eq!(app_counts.get("vim"), Some(&5));
        assert_eq!(app_counts.get("git"), Some(&1));
        assert_eq!(app_counts.get("cargo"), Some(&1));
    }
}

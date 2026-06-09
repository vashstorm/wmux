use serde::{Deserialize, Serialize};
use std::time::Duration;
use wmux_core::intelligence::{
    self, ActiveProvider, IntelligenceStore, SessionIntelligence, WindowCacheDecision,
};
use wmux_core::ipc_error::{IpcError, IpcResult};
use wmux_core::storage::{AiUsageRepository, models::NewAiUsageEvent};
use wmux_core::tmux::{Adapter, Pane, Session, TmuxError, Window};

use crate::services::connections::{
    find_connection as svc_find_connection, require_local_connection,
};
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsListResponse {
    pub target_name: String,
    pub mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub adapter_path: String,
    pub data: Vec<Session>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsListResponse {
    pub target_name: String,
    pub session: String,
    pub mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub adapter_path: String,
    pub data: Vec<Window>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanesListResponse {
    pub target_name: String,
    pub session: String,
    pub window: String,
    pub mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub adapter_path: String,
    pub data: Vec<Pane>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeSessionResponse {
    pub target_name: String,
    pub session: String,
    pub status: &'static str,
    pub updated: usize,
    pub skipped: usize,
    pub errors: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intelligence: Option<SessionIntelligence>,
}

#[derive(Deserialize)]
pub struct NamedRequest {
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPaneRequest {
    pub horizontal: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOperationResponse {
    pub target_name: String,
    pub operation: &'static str,
    pub mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub adapter_path: String,
    pub data: Session,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowOperationResponse {
    pub target_name: String,
    pub session: String,
    pub operation: &'static str,
    pub mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub adapter_path: String,
    pub data: Window,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneOperationResponse {
    pub target_name: String,
    pub session: String,
    pub window: String,
    pub operation: &'static str,
    pub mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub adapter_path: String,
    pub data: Pane,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResponse {
    pub target_name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub session: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub window: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub pane: String,
    pub operation: &'static str,
    pub mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub adapter_path: String,
    pub status: &'static str,
}

struct TargetContext {
    name: String,
    mode: String,
    adapter: Adapter,
}

fn adapter(state: &AppState) -> IpcResult<Adapter> {
    let config = state
        .store
        .snapshot()
        .map_err(|_| IpcError::internal("failed to read configuration"))?;
    Ok(Adapter::new(config.tmux.path))
}

async fn target_context(state: &AppState, target_name: String) -> IpcResult<TargetContext> {
    if target_name == "local" {
        return Ok(TargetContext {
            name: target_name,
            mode: "local".to_string(),
            adapter: adapter(state)?,
        });
    }

    let connection = svc_find_connection(state, &target_name)?;
    require_local_connection(&connection)?;
    Ok(TargetContext {
        name: connection.id,
        mode: connection.connection_type,
        adapter: adapter(state)?,
    })
}

async fn require_session(adapter: &Adapter, session: &str) -> IpcResult<()> {
    if adapter.has_session(session).await.map_err(session_error)? {
        Ok(())
    } else {
        Err(IpcError::not_found(format!("session not found: {session}")))
    }
}

fn session_error(error: TmuxError) -> IpcError {
    match error {
        TmuxError::TmuxNotFound { .. }
        | TmuxError::NoSessions
        | TmuxError::TargetNotFound { .. } => IpcError::not_found(error.to_string()),
        TmuxError::CommandFailed { .. }
        | TmuxError::InvalidInput { .. }
        | TmuxError::Parse { .. } => IpcError::bad_request(error.to_string()),
    }
}

fn build_window_target(session: &str, window: &str) -> String {
    format!("{session}:{window}")
}

fn build_pane_target(session: &str, window: &str, pane: &str) -> String {
    format!("{}.{pane}", build_window_target(session, window))
}

pub async fn list_sessions(state: &AppState, target: String) -> IpcResult<SessionsListResponse> {
    let target = target_context(&state, target).await?;
    let mut data = target
        .adapter
        .list_sessions()
        .await
        .map_err(session_error)?;
    apply_cached_session_intelligence(&state, target.name.as_str(), &mut data).await;
    tracing::debug!(target_name = %target.name, "listed tmux sessions");
    Ok(SessionsListResponse {
        target_name: target.name,
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        data,
    })
}

pub async fn create_session(
    state: &AppState,
    target: String,
    name: String,
) -> IpcResult<SessionOperationResponse> {
    let target = target_context(&state, target).await?;
    let data = target
        .adapter
        .new_session(name.trim())
        .await
        .map_err(session_error)?;
    tracing::info!(target_name = %target.name, session = %name, "session created");
    Ok(SessionOperationResponse {
        target_name: target.name,
        operation: "create_session",
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        data,
    })
}

pub async fn analyze_session(
    state: &AppState,
    target: String,
    session: String,
) -> IpcResult<AnalyzeSessionResponse> {
    let target = target_context(&state, target).await?;
    require_session(&target.adapter, &session).await?;

    let config = state
        .store
        .snapshot()
        .map_err(|_| IpcError::bad_request("failed to read configuration"))?;

    let Some(provider) = intelligence::active_provider(&config) else {
        return Err(IpcError::bad_request(
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

    Ok(AnalyzeSessionResponse {
        target_name: target.name,
        session,
        status: if errors == 0 { "ok" } else { "error" },
        updated,
        skipped,
        errors,
        intelligence: Some(aggregated),
    })
}

pub async fn list_windows(
    state: &AppState,
    target: String,
    session: String,
) -> IpcResult<WindowsListResponse> {
    let target = target_context(&state, target).await?;
    require_session(&target.adapter, &session).await?;
    let mut data = target
        .adapter
        .list_windows(&session)
        .await
        .map_err(session_error)?;
    apply_cached_window_intelligence(&state, target.name.as_str(), session.as_str(), &mut data)
        .await;
    Ok(WindowsListResponse {
        target_name: target.name,
        session: session.clone(),
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        data,
    })
}

pub async fn create_window(
    state: &AppState,
    target: String,
    session: String,
    name: String,
) -> IpcResult<WindowOperationResponse> {
    let target = target_context(&state, target).await?;
    require_session(&target.adapter, &session).await?;
    let data = target
        .adapter
        .new_window(&session, name.trim())
        .await
        .map_err(session_error)?;
    tracing::info!(target_name = %target.name, session = %session, window = %name, "window created");
    Ok(WindowOperationResponse {
        target_name: target.name,
        session,
        operation: "create_window",
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        data,
    })
}

pub async fn list_panes(
    state: &AppState,
    target: String,
    session: String,
    window: String,
) -> IpcResult<PanesListResponse> {
    let target = target_context(&state, target).await?;
    require_session(&target.adapter, &session).await?;
    let data = target
        .adapter
        .list_panes(&session, &window)
        .await
        .map_err(session_error)?;
    Ok(PanesListResponse {
        target_name: target.name,
        session,
        window,
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        data,
    })
}

pub async fn delete_session(
    state: &AppState,
    target: String,
    session: String,
) -> IpcResult<OperationResponse> {
    write_session_operation(
        state.clone(),
        target,
        session,
        String::new(),
        String::new(),
        "delete_session",
    )
    .await
}

pub async fn rename_session(
    state: &AppState,
    target: String,
    session: String,
    new_name: String,
) -> IpcResult<OperationResponse> {
    let target = target_context(&state, target).await?;
    require_session(&target.adapter, &session).await?;
    target
        .adapter
        .rename_session(&session, new_name.trim())
        .await
        .map_err(session_error)?;
    tracing::info!(target_name = %target.name, session = %session, new_name = %new_name, "session renamed");
    Ok(OperationResponse {
        target_name: target.name,
        session,
        window: String::new(),
        pane: String::new(),
        operation: "rename_session",
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        status: "accepted",
    })
}

pub async fn delete_window(
    state: &AppState,
    target: String,
    session: String,
    window: String,
) -> IpcResult<OperationResponse> {
    write_session_operation(
        state.clone(),
        target,
        session,
        window,
        String::new(),
        "delete_window",
    )
    .await
}

pub async fn split_pane(
    state: &AppState,
    target: String,
    session: String,
    window: String,
    pane: String,
    horizontal: bool,
) -> IpcResult<PaneOperationResponse> {
    let target = target_context(&state, target).await?;
    require_session(&target.adapter, &session).await?;
    let pane_target = build_pane_target(&session, &window, &pane);
    let data = target
        .adapter
        .split_window(&pane_target, horizontal)
        .await
        .map_err(session_error)?;
    tracing::info!(target_name = %target.name, session = %session, window = %window, pane = %pane, "pane split");
    Ok(PaneOperationResponse {
        target_name: target.name,
        session,
        window,
        operation: "split_pane",
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        data,
    })
}

pub async fn delete_pane(
    state: &AppState,
    target: String,
    session: String,
    window: String,
    pane: String,
) -> IpcResult<OperationResponse> {
    write_session_operation(state.clone(), target, session, window, pane, "delete_pane").await
}

async fn write_session_operation(
    state: AppState,
    target_name: String,
    session: String,
    window: String,
    pane: String,
    operation: &'static str,
) -> IpcResult<OperationResponse> {
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
    Ok(OperationResponse {
        target_name: target.name,
        session,
        window,
        pane,
        operation,
        mode: target.mode,
        adapter_path: target.adapter.path().to_string(),
        status: "accepted",
    })
}

#[derive(Deserialize)]
struct DbWindowIntelligence {
    #[serde(default)]
    app: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    confidence: f32,
    #[serde(default)]
    source: String,
}

fn canonical_analysis_target_name(target_name: &str) -> &str {
    if target_name == "local" {
        target_name
    } else {
        "local"
    }
}

fn aggregate_window_results_no_provider(results: &[WindowAnalysisResult]) -> SessionIntelligence {
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
        } else {
            *app_counts
                .entry(result.intelligence.app.clone())
                .or_insert(0) += 1;
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
        source: highest.intelligence.source.clone(),
        confidence: max_confidence,
        stale: any_stale,
        updated_at: highest.intelligence.updated_at.clone(),
        error,
        app_counts: if app_counts.is_empty() {
            None
        } else {
            Some(app_counts)
        },
    }
}

async fn apply_cached_session_intelligence(
    state: &AppState,
    target_name: &str,
    sessions: &mut [Session],
) {
    if let Some(pool) = &state.storage {
        for session in sessions.iter_mut() {
            // Try in-memory cache first if configured and active
            let mut got_cached = false;
            if let Ok(config) = state.store.snapshot() {
                if intelligence::active_provider(&config).is_some() {
                    let cache_ttl = Duration::from_secs(config.intelligence.cache_ttl_sec as u64);
                    if let Some(result) =
                        state
                            .intelligence
                            .get(target_name, session.name.as_str(), cache_ttl)
                    {
                        apply_session_intelligence(session, &result);
                        got_cached = true;
                    }
                }
            }

            if got_cached {
                continue;
            }

            // Retrieve from SQLite and aggregate
            let analysis_target_name = canonical_analysis_target_name(target_name);
            let query_result = sqlx::query_as::<_, (i64, String, String)>(
                "WITH ranked_events AS ( \
                     SELECT window_number, response_json, created_at, \
                            ROW_NUMBER() OVER (PARTITION BY window_number ORDER BY created_at DESC) as rn \
                     FROM ai_usage_events \
                     WHERE target_name IN (?, ?) \
                       AND session_name = ? \
                       AND status = 'success' \
                       AND window_number IS NOT NULL \
                       AND response_json IS NOT NULL \
                 ) \
                 SELECT window_number, response_json, created_at \
                 FROM ranked_events \
                 WHERE rn = 1"
            )
            .bind(target_name)
            .bind(analysis_target_name)
            .bind(session.name.as_str())
            .fetch_all(pool)
            .await;

            if let Ok(rows) = query_result {
                if !rows.is_empty() {
                    let mut window_results = Vec::new();
                    for (_window_number, response_json, created_at) in rows {
                        if let Ok(db_intel) =
                            serde_json::from_str::<DbWindowIntelligence>(&response_json)
                        {
                            let intel = SessionIntelligence {
                                app: db_intel.app,
                                status: db_intel.status,
                                summary: db_intel.summary,
                                source: db_intel.source,
                                confidence: db_intel.confidence,
                                stale: false,
                                updated_at: created_at,
                                error: None,
                                app_counts: None,
                            };
                            window_results.push(WindowAnalysisResult {
                                intelligence: intel,
                                provider_called: false,
                                is_error: false,
                            });
                        }
                    }

                    if !window_results.is_empty() {
                        let aggregated = aggregate_window_results_no_provider(&window_results);
                        apply_session_intelligence(session, &aggregated);
                    }
                }
            }
        }
    }
}

async fn apply_cached_window_intelligence(
    state: &AppState,
    target_name: &str,
    session_name: &str,
    windows: &mut [Window],
) {
    // 内存缓存只作为兜底；SQLite 中的最新成功分析记录是窗口 header 的权威来源。
    if let Ok(config) = state.store.snapshot() {
        if intelligence::active_provider(&config).is_some() {
            let cache_ttl = Duration::from_secs(config.intelligence.cache_ttl_sec as u64);
            for window in windows.iter_mut() {
                if let Some((result, _, _, _, _)) = state.intelligence.get_window(
                    target_name,
                    session_name,
                    window.id.as_str(),
                    cache_ttl,
                ) {
                    apply_window_intelligence(window, &result);
                }
            }
        }
    }

    if let Some(pool) = &state.storage {
        let analysis_target_name = canonical_analysis_target_name(target_name);
        let query_result = sqlx::query_as::<_, (i64, String, String)>(
            "WITH ranked_events AS ( \
                 SELECT window_number, response_json, created_at, \
                        ROW_NUMBER() OVER (PARTITION BY window_number ORDER BY created_at DESC) as rn \
                 FROM ai_usage_events \
                 WHERE target_name IN (?, ?) \
                   AND session_name = ? \
                   AND status = 'success' \
                   AND window_number IS NOT NULL \
                   AND response_json IS NOT NULL \
             ) \
             SELECT window_number, response_json, created_at \
             FROM ranked_events \
             WHERE rn = 1"
        )
        .bind(target_name)
        .bind(analysis_target_name)
        .bind(session_name)
        .fetch_all(pool)
        .await;

        match query_result {
            Ok(rows) => {
                for (window_number, response_json, created_at) in rows {
                    if let Ok(db_intel) =
                        serde_json::from_str::<DbWindowIntelligence>(&response_json)
                    {
                        let intel = SessionIntelligence {
                            app: db_intel.app,
                            status: db_intel.status,
                            summary: db_intel.summary,
                            source: db_intel.source,
                            confidence: db_intel.confidence,
                            stale: false,
                            updated_at: created_at,
                            error: None,
                            app_counts: None,
                        };
                        if let Some(window) = windows
                            .iter_mut()
                            .find(|w| w.index == window_number as usize)
                        {
                            apply_window_intelligence(window, &intel);
                        }
                    }
                }
            }
            Err(err) => {
                tracing::error!(
                    target_name = %target_name,
                    session_name = %session_name,
                    error = %err,
                    "failed to fetch window intelligence from sqlite"
                );
            }
        }
    }
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

const WINDOW_AI_TRANSCRIPT_MAX_BYTES: u32 = 20_000;

struct WindowAnalysisResult {
    intelligence: SessionIntelligence,
    provider_called: bool,
    is_error: bool,
}

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
        .unwrap_or(intelligence::CommandClass::Unknown);
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

            if let Some(pool) = pool {
                let provider_name = if provider.provider.trim().is_empty() {
                    provider.name.clone()
                } else {
                    provider.provider.clone()
                };
                let response_json = serde_json::json!({
                    "app": intelligence.app,
                    "status": intelligence.status,
                    "summary": intelligence.summary,
                    "confidence": intelligence.confidence,
                    "source": intelligence.source,
                })
                .to_string();
                let error_message = match &result {
                    Err(err) => Some(err.message.clone()),
                    Ok(_) => None,
                };
                let event = NewAiUsageEvent {
                    project_id: None,
                    provider: provider_name,
                    model: provider.model.clone(),
                    target_name: canonical_analysis_target_name(target_name).to_string(),
                    session_name: session_name.to_string(),
                    status: if is_error {
                        "error".to_string()
                    } else {
                        "success".to_string()
                    },
                    duration_ms: elapsed_ms,
                    prompt_tokens: result.as_ref().ok().and_then(|r| r.prompt_tokens),
                    completion_tokens: result.as_ref().ok().and_then(|r| r.completion_tokens),
                    total_tokens: result.as_ref().ok().and_then(|r| r.total_tokens),
                    estimated_cost: None,
                    error_message,
                    window_number: Some(window.index as i64),
                    response_json: Some(response_json),
                };
                let repo = AiUsageRepository::new(pool.clone());
                if let Err(err) = repo.insert(&event).await {
                    tracing::error!(target_name = %target_name, session_name = %session_name, window_id = %window.id, raw_error = %err, "failed to record window analysis usage event");
                }
            }

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
mod tests {
    use super::*;

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
    fn build_window_target_works() {
        assert_eq!(
            build_window_target("session1", "window1"),
            "session1:window1"
        );
    }

    #[test]
    fn build_pane_target_works() {
        assert_eq!(
            build_pane_target("session1", "window1", "pane1"),
            "session1:window1.pane1"
        );
    }

    #[tokio::test]
    async fn test_apply_cached_window_intelligence_from_db() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        wmux_core::storage::db::run_migrations(&pool).await.unwrap();

        let response_json = serde_json::json!({
            "app": "vim",
            "status": "running",
            "summary": "Editing test file",
            "confidence": 0.9,
            "source": "openai/gpt-4"
        })
        .to_string();

        let repo = wmux_core::storage::AiUsageRepository::new(pool.clone());
        let event = wmux_core::storage::models::NewAiUsageEvent {
            project_id: None,
            provider: "openai".to_string(),
            model: "gpt-4".to_string(),
            target_name: "local".to_string(),
            session_name: "test-session".to_string(),
            status: "success".to_string(),
            duration_ms: 100,
            prompt_tokens: None,
            completion_tokens: None,
            total_tokens: None,
            estimated_cost: None,
            error_message: None,
            window_number: Some(1),
            response_json: Some(response_json),
        };
        repo.insert(&event).await.unwrap();

        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("config.jsonc");
        let store = wmux_core::config::load(&config_path).unwrap();

        let app_state = AppState {
            store,
            connections: crate::state::RuntimeConnections::default(),
            sessions: wmux_core::session::SessionManager::new(),
            intelligence: wmux_core::intelligence::IntelligenceStore::default(),
            assets_dir: std::path::PathBuf::from("."),
            logging_handle: wmux_core::logging::LoggingHandle::empty(),
            storage: Some(pool),
            cleanup_handle: None,
            sync_handle: None,
            analysis_handle: None,
            skills: crate::state::RuntimeSkills::default(),
        };

        let mut windows = vec![Window::new(
            "window-id".to_string(),
            "win1".to_string(),
            1,
            true,
            1,
            "pane-id".to_string(),
            "pane-title".to_string(),
        )];

        apply_cached_window_intelligence(&app_state, "local", "test-session", &mut windows).await;

        assert_eq!(windows[0].intelligence_app.as_deref(), Some("vim"));
        assert_eq!(windows[0].intelligence_status.as_deref(), Some("running"));
        assert_eq!(
            windows[0].intelligence_summary.as_deref(),
            Some("Editing test file")
        );
    }

    #[tokio::test]
    async fn test_apply_cached_window_intelligence_prefers_sqlite_over_memory_cache() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        wmux_core::storage::db::run_migrations(&pool).await.unwrap();

        let response_json = serde_json::json!({
            "app": "vim",
            "status": "running",
            "summary": "SQLite summary",
            "confidence": 0.9,
            "source": "deepseek/deepseek-v4-flash"
        })
        .to_string();

        let repo = wmux_core::storage::AiUsageRepository::new(pool.clone());
        let event = wmux_core::storage::models::NewAiUsageEvent {
            project_id: None,
            provider: "deepseek".to_string(),
            model: "deepseek-v4-flash".to_string(),
            target_name: "local".to_string(),
            session_name: "test-session".to_string(),
            status: "success".to_string(),
            duration_ms: 100,
            prompt_tokens: None,
            completion_tokens: None,
            total_tokens: None,
            estimated_cost: None,
            error_message: None,
            window_number: Some(1),
            response_json: Some(response_json),
        };
        repo.insert(&event).await.unwrap();

        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("config.jsonc");
        let store = wmux_core::config::load(&config_path).unwrap();
        let mut config = store.snapshot().unwrap();
        config.intelligence.enabled = true;
        config.intelligence.active_provider = "test".to_string();
        config.intelligence.providers = vec![wmux_core::config::IntelligenceProviderConfig {
            name: "test".to_string(),
            provider: "deepseek".to_string(),
            model: "deepseek-v4-flash".to_string(),
            api_key: "test-key".to_string(),
            base_url: "https://example.test/v1".to_string(),
        }];
        store.replace_in_memory(config).unwrap();

        let intelligence_store = wmux_core::intelligence::IntelligenceStore::default();
        intelligence_store.set_window(
            "local",
            "test-session",
            "window-id",
            SessionIntelligence {
                app: "stale-cache".to_string(),
                status: "none".to_string(),
                summary: "Stale summary".to_string(),
                source: "memory".to_string(),
                confidence: 0.1,
                stale: false,
                updated_at: wmux_core::intelligence::now_rfc3339(),
                error: None,
                app_counts: None,
            },
            "hash",
            wmux_core::intelligence::CommandClass::Unknown,
            "",
            "signature",
        );

        let app_state = AppState {
            store,
            connections: crate::state::RuntimeConnections::default(),
            sessions: wmux_core::session::SessionManager::new(),
            intelligence: intelligence_store,
            assets_dir: std::path::PathBuf::from("."),
            logging_handle: wmux_core::logging::LoggingHandle::empty(),
            storage: Some(pool),
            cleanup_handle: None,
            sync_handle: None,
            analysis_handle: None,
            skills: crate::state::RuntimeSkills::default(),
        };

        let mut windows = vec![Window::new(
            "window-id".to_string(),
            "win1".to_string(),
            1,
            true,
            1,
            "pane-id".to_string(),
            "pane-title".to_string(),
        )];

        apply_cached_window_intelligence(&app_state, "local", "test-session", &mut windows).await;

        assert_eq!(windows[0].intelligence_app.as_deref(), Some("vim"));
        assert_eq!(windows[0].intelligence_status.as_deref(), Some("running"));
        assert_eq!(
            windows[0].intelligence_summary.as_deref(),
            Some("SQLite summary")
        );
    }

    #[tokio::test]
    async fn test_apply_cached_window_intelligence_uses_local_sqlite_rows_for_local_connection_id()
    {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        wmux_core::storage::db::run_migrations(&pool).await.unwrap();

        let response_json = serde_json::json!({
            "app": "opencode",
            "status": "running",
            "summary": "Local canonical target summary",
            "confidence": 0.9,
            "source": "deepseek/deepseek-v4-flash"
        })
        .to_string();

        let repo = wmux_core::storage::AiUsageRepository::new(pool.clone());
        let event = wmux_core::storage::models::NewAiUsageEvent {
            project_id: None,
            provider: "deepseek".to_string(),
            model: "deepseek-v4-flash".to_string(),
            target_name: "local".to_string(),
            session_name: "test-session".to_string(),
            status: "success".to_string(),
            duration_ms: 100,
            prompt_tokens: None,
            completion_tokens: None,
            total_tokens: None,
            estimated_cost: None,
            error_message: None,
            window_number: Some(1),
            response_json: Some(response_json),
        };
        repo.insert(&event).await.unwrap();

        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("config.jsonc");
        let store = wmux_core::config::load(&config_path).unwrap();

        let app_state = AppState {
            store,
            connections: crate::state::RuntimeConnections::default(),
            sessions: wmux_core::session::SessionManager::new(),
            intelligence: wmux_core::intelligence::IntelligenceStore::default(),
            assets_dir: std::path::PathBuf::from("."),
            logging_handle: wmux_core::logging::LoggingHandle::empty(),
            storage: Some(pool),
            cleanup_handle: None,
            sync_handle: None,
            analysis_handle: None,
            skills: crate::state::RuntimeSkills::default(),
        };

        let mut windows = vec![Window::new(
            "window-id".to_string(),
            "win1".to_string(),
            1,
            true,
            1,
            "pane-id".to_string(),
            "pane-title".to_string(),
        )];

        apply_cached_window_intelligence(
            &app_state,
            "95cb2c8932f7b919fc59a3b255fb9390",
            "test-session",
            &mut windows,
        )
        .await;

        assert_eq!(windows[0].intelligence_app.as_deref(), Some("opencode"));
        assert_eq!(windows[0].intelligence_status.as_deref(), Some("running"));
        assert_eq!(
            windows[0].intelligence_summary.as_deref(),
            Some("Local canonical target summary")
        );
    }
}

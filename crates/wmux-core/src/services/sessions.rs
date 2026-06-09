use serde::{Deserialize, Serialize};
use std::time::Duration;
use wmux_core::config::Config;
use wmux_core::intelligence::{
    self, ActiveProvider, IntelligenceStore, SessionIntelligence, WindowCacheDecision,
};
use wmux_core::ipc_error::{IpcError, IpcResult};
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
    apply_cached_session_intelligence(&state, target.name.as_str(), &mut data);
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
    apply_cached_window_intelligence(&state, target.name.as_str(), session.as_str(), &mut data);
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

fn apply_cached_session_intelligence(
    state: &AppState,
    target_name: &str,
    sessions: &mut [Session],
) {
    let Ok(config) = state.store.snapshot() else {
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
    let Ok(config) = state.store.snapshot() else {
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
}

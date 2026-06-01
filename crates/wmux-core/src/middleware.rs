use std::sync::Arc;
use std::time::Instant;

use axum::extract::{Request, State};
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use wmux_core::protocol::ErrorResponse;

use crate::http::ApiErrorLog;
use crate::state::{AppState, CachedConfig};

pub async fn auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    authenticate(state, request, false, next).await
}

pub async fn terminal_auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    authenticate(state, request, true, next).await
}

pub async fn logging_middleware(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let uri = redacted_uri(request.uri());
    let target_name = target_name_from_request(request.uri(), &path).unwrap_or_default();
    let start = Instant::now();

    let response = next.run(request).await;
    let status = response.status();
    let error_log = response.extensions().get::<ApiErrorLog>().cloned();

    if !(method == Method::GET && status.as_u16() < 400) {
        let duration_ms = start.elapsed().as_millis();
        if status.as_u16() >= 500 {
            tracing::error!(
                %method,
                %path,
                %uri,
                %status,
                duration_ms,
                target_name = %target_name,
                error_code = error_log.as_ref().map(|error| error.code).unwrap_or_default(),
                error_message = error_log.as_ref().map(|error| error.message.as_str()).unwrap_or_default(),
                "http request failed"
            );
        } else if status.as_u16() >= 400 && error_log.is_some() {
            tracing::error!(
                %method,
                %path,
                %uri,
                %status,
                duration_ms,
                target_name = %target_name,
                error_code = error_log.as_ref().map(|error| error.code).unwrap_or_default(),
                error_message = error_log.as_ref().map(|error| error.message.as_str()).unwrap_or_default(),
                "http request failed"
            );
        } else if status.as_u16() >= 400 {
            tracing::warn!(%method, %path, %uri, %status, duration_ms, "http request failed");
        } else {
            tracing::debug!(%method, %path, %uri, %status, duration_ms, "http request");
        }
    }

    response
}

fn redacted_uri(uri: &axum::http::Uri) -> String {
    let Some(query) = uri.query() else {
        return uri.path().to_string();
    };
    let query = query
        .split('&')
        .map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            if matches!(key, "token" | "authToken" | "access_token") {
                format!("{key}=<redacted>")
            } else if value.is_empty() {
                key.to_string()
            } else {
                format!("{key}={value}")
            }
        })
        .collect::<Vec<_>>()
        .join("&");
    format!("{}?{}", uri.path(), query)
}

fn target_name_from_request(uri: &axum::http::Uri, path: &str) -> Option<String> {
    target_name_from_path(path).or_else(|| target_name_from_query(uri.query()?))
}

fn target_name_from_path(path: &str) -> Option<String> {
    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    while let Some(segment) = segments.next() {
        if segment == "targets" || segment == "connections" {
            return segments.next().map(ToString::to_string);
        }
    }
    None
}

fn target_name_from_query(query: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        (key == "targetName").then(|| value.to_string())
    })
}

async fn authenticate(
    state: AppState,
    mut request: Request,
    allow_query_token: bool,
    next: Next,
) -> Response {
    let token = match state.store.snapshot() {
        Ok(config) => {
            let token = config.auth.token.trim().to_string();
            request.extensions_mut().insert(CachedConfig(Arc::new(config)));
            token
        }
        Err(error) => {
            tracing::error!(raw_error = %error, "failed to read config for auth");
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "failed to read configuration",
            );
        }
    };

    let bearer_matches = bearer_token(&request) == Some(token.as_str());
    let query_matches =
        allow_query_token && query_token(&request).as_deref() == Some(token.as_str());

    if token.is_empty() || bearer_matches || query_matches {
        return next.run(request).await;
    }

    error_response(
        StatusCode::UNAUTHORIZED,
        "unauthorized",
        "missing or invalid authentication token",
    )
}

fn bearer_token(request: &Request) -> Option<&str> {
    request
        .headers()
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::trim)
}

fn query_token(request: &Request) -> Option<String> {
    request
        .uri()
        .query()?
        .split('&')
        .find_map(|part| part.strip_prefix("token="))
        .and_then(percent_decode_query_value)
}

fn percent_decode_query_value(value: &str) -> Option<String> {
    let mut decoded = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok()?;
                decoded.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            }
            b'%' => return None,
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(decoded).ok()
}

fn error_response(status: StatusCode, code: &'static str, message: &'static str) -> Response {
    (status, axum::Json(ErrorResponse::new(code, message))).into_response()
}

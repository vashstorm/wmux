use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use wmux_core::protocol::ErrorResponse;

pub type ApiResult<T> = Result<Json<T>, ApiError>;

#[derive(Debug, Clone)]
pub struct ApiErrorLog {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, "conflict", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", message)
    }

    pub fn not_implemented(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_IMPLEMENTED, "not_implemented", message)
    }

    pub fn code(&self) -> &'static str {
        self.code
    }

    pub fn message(&self) -> &str {
        self.message.as_str()
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message.as_str())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let log = ApiErrorLog {
            code: self.code,
            message: self.message.clone(),
        };
        let mut response = (
            self.status,
            Json(ErrorResponse::new(self.code, self.message)),
        )
            .into_response();
        response.extensions_mut().insert(log);
        response
    }
}

pub async fn api_not_found() -> ApiError {
    ApiError::not_found("resource not found")
}

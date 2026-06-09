use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use crate::protocol::{ERROR_BAD_REQUEST, ERROR_CONFLICT, ERROR_NOT_FOUND};

/// IPC error types for Tauri command results.
///
/// These errors are used for business logic errors in Tauri IPC commands.
/// Note: `unauthorized` is NOT used for normal command business logic -
/// it only applies to actual authentication failures.
#[derive(Debug, Clone, Serialize, Deserialize, Error)]
#[serde(try_from = "IpcErrorPayload", into = "IpcErrorPayload")]
#[error("{code}: {message}")]
pub enum IpcError {
    /// Resource not found (e.g., connection, session, window, pane).
    #[error("not_found: {0}")]
    NotFound(String),

    /// Invalid request parameters or input validation failure.
    #[error("bad_request: {0}")]
    BadRequest(String),

    /// Resource conflict (e.g., duplicate name, external modification).
    #[error("conflict: {0}")]
    Conflict(String),

    /// Internal server or unexpected error.
    #[error("internal_error: {0}")]
    Internal(String),
}

impl IpcError {
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::BadRequest(message.into())
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }

    /// Returns the stable error code for this error.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound(_) => ERROR_NOT_FOUND,
            Self::BadRequest(_) => ERROR_BAD_REQUEST,
            Self::Conflict(_) => ERROR_CONFLICT,
            Self::Internal(_) => "internal_error",
        }
    }

    /// Returns the error message.
    pub fn message(&self) -> &str {
        match self {
            Self::NotFound(msg) => msg,
            Self::BadRequest(msg) => msg,
            Self::Conflict(msg) => msg,
            Self::Internal(msg) => msg,
        }
    }
}

/// Flat JSON payload for IpcError serialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct IpcErrorPayload {
    pub code: String,
    pub message: String,
}

impl From<IpcError> for IpcErrorPayload {
    fn from(error: IpcError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.message().to_string(),
        }
    }
}

impl TryFrom<IpcErrorPayload> for IpcError {
    type Error = String;

    fn try_from(payload: IpcErrorPayload) -> Result<Self, Self::Error> {
        match payload.code.as_str() {
            ERROR_NOT_FOUND => Ok(Self::NotFound(payload.message)),
            ERROR_BAD_REQUEST => Ok(Self::BadRequest(payload.message)),
            ERROR_CONFLICT => Ok(Self::Conflict(payload.message)),
            "internal_error" => Ok(Self::Internal(payload.message)),
            other => Err(format!("unknown error code: {}", other)),
        }
    }
}

/// Result type alias for Tauri IPC commands.
pub type IpcResult<T> = Result<T, IpcError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_error_not_found_serializes_correctly() {
        let error = IpcError::not_found("connection 'local' not found");
        let json = serde_json::to_string(&error).expect("serialize");
        let value = serde_json::to_value(&error).expect("serialize");

        assert_eq!(value["code"], "not_found");
        assert_eq!(value["message"], "connection 'local' not found");
        assert!(json.contains("not_found"));
    }

    #[test]
    fn ipc_error_bad_request_serializes_correctly() {
        let error = IpcError::bad_request("invalid session name");
        let value = serde_json::to_value(&error).expect("serialize");

        assert_eq!(value["code"], "bad_request");
        assert_eq!(value["message"], "invalid session name");
    }

    #[test]
    fn ipc_error_conflict_serializes_correctly() {
        let error = IpcError::conflict("config file changed on disk");
        let value = serde_json::to_value(&error).expect("serialize");

        assert_eq!(value["code"], "conflict");
        assert_eq!(value["message"], "config file changed on disk");
    }

    #[test]
    fn ipc_error_internal_serializes_correctly() {
        let error = IpcError::internal("tmux process crashed");
        let value = serde_json::to_value(&error).expect("serialize");

        assert_eq!(value["code"], "internal_error");
        assert_eq!(value["message"], "tmux process crashed");
    }

    #[test]
    fn ipc_error_deserializes_round_trip() {
        let errors = [
            IpcError::not_found("test"),
            IpcError::bad_request("test"),
            IpcError::conflict("test"),
            IpcError::internal("test"),
        ];

        for error in errors {
            let json = serde_json::to_string(&error).expect("serialize");
            let decoded: IpcError = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(decoded.code(), error.code());
            assert_eq!(decoded.message(), error.message());
        }
    }

    #[test]
    fn ipc_error_code_method() {
        assert_eq!(IpcError::not_found("x").code(), "not_found");
        assert_eq!(IpcError::bad_request("x").code(), "bad_request");
        assert_eq!(IpcError::conflict("x").code(), "conflict");
        assert_eq!(IpcError::internal("x").code(), "internal_error");
    }

    #[test]
    fn ipc_error_message_method() {
        assert_eq!(IpcError::not_found("foo").message(), "foo");
        assert_eq!(IpcError::bad_request("bar").message(), "bar");
        assert_eq!(IpcError::conflict("baz").message(), "baz");
        assert_eq!(IpcError::internal("qux").message(), "qux");
    }

    #[test]
    fn ipc_result_is_result_type() {
        let success: IpcResult<String> = Ok("hello".to_string());
        let failure: IpcResult<String> = Err(IpcError::not_found("not found"));

        assert!(success.is_ok());
        assert!(failure.is_err());
        assert_eq!(failure.unwrap_err().code(), "not_found");
    }

    #[test]
    fn ipc_error_clone() {
        let error = IpcError::conflict("test conflict");
        let cloned = error.clone();
        assert_eq!(error.code(), cloned.code());
        assert_eq!(error.message(), cloned.message());
    }

    #[test]
    fn ipc_error_debug() {
        let error = IpcError::bad_request("test");
        let debug_str = format!("{:?}", error);
        assert!(debug_str.contains("BadRequest"));
        assert!(debug_str.contains("test"));
    }

    #[test]
    fn ipc_error_serde_json_shape() {
        // Verify the JSON shape matches ErrorResponse structure
        let error = IpcError::not_found("connection missing");
        let value = serde_json::to_value(&error).expect("serialize");

        // IpcError serializes directly to the error object (no wrapper)
        assert_eq!(value["code"], "not_found");
        assert_eq!(value["message"], "connection missing");
    }
}
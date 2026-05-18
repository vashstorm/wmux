use serde::de::{Error as DeError, Unexpected};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub const ERROR_UNAUTHORIZED: &str = "unauthorized";
pub const ERROR_NOT_FOUND: &str = "not_found";
pub const ERROR_BAD_REQUEST: &str = "bad_request";
pub const ERROR_CONFLICT: &str = "conflict";
pub const ERROR_NOT_IMPLEMENTED: &str = "not_implemented";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

impl ErrorResponse {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error: ErrorDetail {
                code: code.into(),
                message: message.into(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalMessage {
    Input(String),
    Output(String),
    Resize { cols: u16, rows: u16 },
    Close,
    Error(String),
}

impl Serialize for TerminalMessage {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Input(data) => serialize_data_message(serializer, "input", data),
            Self::Output(data) => serialize_data_message(serializer, "output", data),
            Self::Error(data) => serialize_data_message(serializer, "error", data),
            Self::Resize { cols, rows } => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("type", "resize")?;
                map.serialize_entry("cols", cols)?;
                map.serialize_entry("rows", rows)?;
                map.end()
            }
            Self::Close => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("type", "close")?;
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for TerminalMessage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawTerminalMessage::deserialize(deserializer)?;
        match raw.message_type.as_str() {
            "input" => Ok(Self::Input(raw.data.unwrap_or_default())),
            "output" => Ok(Self::Output(raw.data.unwrap_or_default())),
            "resize" => Ok(Self::Resize {
                cols: raw.cols.ok_or_else(|| DeError::missing_field("cols"))?,
                rows: raw.rows.ok_or_else(|| DeError::missing_field("rows"))?,
            }),
            "close" => Ok(Self::Close),
            "error" => Ok(Self::Error(raw.data.unwrap_or_default())),
            other => Err(DeError::invalid_value(
                Unexpected::Str(other),
                &"input, output, resize, close, or error",
            )),
        }
    }
}

#[derive(Deserialize)]
struct RawTerminalMessage {
    #[serde(rename = "type")]
    message_type: String,
    #[serde(default)]
    data: Option<String>,
    #[serde(default)]
    cols: Option<u16>,
    #[serde(default)]
    rows: Option<u16>,
}

fn serialize_data_message<S>(
    serializer: S,
    message_type: &str,
    data: &str,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let mut map = serializer.serialize_map(Some(2))?;
    map.serialize_entry("type", message_type)?;
    map.serialize_entry("data", data)?;
    map.end()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_terminal_message_round_trips() {
        let messages = [
            TerminalMessage::Input("hello".to_string()),
            TerminalMessage::Output("world".to_string()),
            TerminalMessage::Resize {
                cols: 120,
                rows: 40,
            },
            TerminalMessage::Close,
            TerminalMessage::Error("boom".to_string()),
        ];

        for message in messages {
            let json = serde_json::to_string(&message).expect("serialize");
            let decoded: TerminalMessage = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(decoded, message);
        }
    }

    #[test]
    fn protocol_terminal_message_uses_go_json_shape() {
        assert_eq!(
            serde_json::to_value(TerminalMessage::Input("hello".to_string())).expect("serialize"),
            serde_json::json!({ "type": "input", "data": "hello" })
        );
        assert_eq!(
            serde_json::to_value(TerminalMessage::Resize { cols: 80, rows: 24 })
                .expect("serialize"),
            serde_json::json!({ "type": "resize", "cols": 80, "rows": 24 })
        );
    }

    #[test]
    fn protocol_error_response_serializes_stable_codes() {
        let response = ErrorResponse {
            error: ErrorDetail {
                code: ERROR_CONFLICT.to_string(),
                message: "config file changed on disk".to_string(),
            },
        };

        assert_eq!(
            serde_json::to_value(response).expect("serialize"),
            serde_json::json!({ "error": { "code": "conflict", "message": "config file changed on disk" } })
        );
    }

    #[test]
    fn protocol_exports_stable_error_codes() {
        assert_eq!(ERROR_UNAUTHORIZED, "unauthorized");
        assert_eq!(ERROR_NOT_FOUND, "not_found");
        assert_eq!(ERROR_BAD_REQUEST, "bad_request");
        assert_eq!(ERROR_CONFLICT, "conflict");
        assert_eq!(ERROR_NOT_IMPLEMENTED, "not_implemented");
    }
}

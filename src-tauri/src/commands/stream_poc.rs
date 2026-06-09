use tauri::{AppHandle, Emitter, ipc::Channel};

/// Payload for the stream-burst-complete event.
#[derive(Clone, serde::Serialize)]
pub struct StreamBurstComplete {
    pub total: u32,
}

/// Stream burst command - sends count deterministic line chunks via Channel.
/// Emits "stream-burst-complete" event when done.
#[tauri::command]
pub async fn stream_burst(
    app: AppHandle,
    count: u32,
    on_event: Channel<String>,
) -> Result<(), String> {
    if count == 0 {
        return Err("count must be greater than 0".to_string());
    }

    // Spawn async task to send chunks in background - channel owner receives in frontend
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        for i in 0..count {
            let line = format!("line_{}", i);
            if let Err(e) = on_event.send(line) {
                tracing::error!("failed to send channel message: {}", e);
                break;
            }
        }

        // Emit completion event
        let payload = StreamBurstComplete { total: count };
        if let Err(e) = app_clone.emit("stream-burst-complete", payload) {
            tracing::error!("failed to emit stream-burst-complete event: {}", e);
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_burst_complete_payload_serialization() {
        let payload = StreamBurstComplete { total: 100 };
        let json = serde_json::to_string(&payload).unwrap();
        assert_eq!(json, r#"{"total":100}"#);
    }
}

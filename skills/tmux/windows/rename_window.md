---
enabled: true
---

# Rename Window

Rename an existing tmux window by its current name or index.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server."
    },
    "session_name": {
      "type": "string",
      "description": "Session name containing the window."
    },
    "window_name": {
      "type": "string",
      "description": "Current window name or index."
    },
    "new_name": {
      "type": "string",
      "description": "New name for the window."
    }
  },
  "required": ["target_name", "session_name", "window_name", "new_name"]
}
```

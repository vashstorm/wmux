---
enabled: true
---

# Create Window

Create a new tmux window inside an existing session.

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
      "description": "Session name to create the window in."
    },
    "window_name": {
      "type": "string",
      "description": "Name for the new window."
    }
  },
  "required": ["target_name", "session_name", "window_name"]
}
```

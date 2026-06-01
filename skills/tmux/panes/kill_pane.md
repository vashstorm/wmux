---
enabled: true
---

# Kill Pane

Kill a specific tmux pane, terminating any process running inside it. This is destructive and requires confirmation.

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
      "description": "Session name."
    },
    "window_name": {
      "type": "string",
      "description": "Window name or index."
    },
    "pane_index": {
      "type": "string",
      "description": "Pane index or ID to kill."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index"]
}
```

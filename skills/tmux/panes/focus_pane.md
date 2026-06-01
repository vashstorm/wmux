---
enabled: true
---

# Focus Pane

Switch the UI focus to a specific session, window, and pane without sending any input.
Use this to navigate the user's view without executing commands.

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
      "description": "Pane index or ID to focus."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index"]
}
```

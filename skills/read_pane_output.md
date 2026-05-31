---
enabled: true
---

# Read Pane Output

Read the last N lines of visible output from a tmux pane for context.
Useful to understand what is running or what happened before taking action.
Lines default to 50, maximum 500.

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
      "description": "Pane index or ID within the window."
    },
    "lines": {
      "type": "integer",
      "default": 50,
      "description": "Number of lines to capture (max 500)."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index"]
}
```

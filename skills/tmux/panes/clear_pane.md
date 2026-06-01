---
enabled: true
---

# Clear Pane

Clear the visible content and scroll history of a tmux pane.
Equivalent to running the clear command and clearing tmux scroll history.

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
      "description": "Pane index or ID to clear."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index"]
}
```

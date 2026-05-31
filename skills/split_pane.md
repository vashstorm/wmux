---
enabled: true
---

# Split Pane

Split a tmux pane horizontally or vertically to create a new pane in the same window.
Horizontal splits create a pane to the right; vertical splits create a pane below.

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
      "description": "Pane index or ID to split."
    },
    "horizontal": {
      "type": "boolean",
      "default": false,
      "description": "If true, split horizontally (side by side). If false, split vertically (top/bottom)."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index"]
}
```

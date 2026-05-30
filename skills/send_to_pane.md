---
enabled: true
---

# Send To Pane

Send text or commands to a tmux pane. WARNING: With execute=true, append_enter=true, control=true, or multiline=true, this is dangerous and requires confirmation.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
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
      "type": "integer",
      "description": "Pane index within window."
    },
    "text": {
      "type": "string",
      "description": "Text to send to the pane."
    },
    "execute": {
      "type": "boolean",
      "default": false,
      "description": "If true, execute as command (dangerous)."
    },
    "append_enter": {
      "type": "boolean",
      "default": false,
      "description": "If true, append Enter key after text (dangerous)."
    },
    "control": {
      "type": "boolean",
      "default": false,
      "description": "If true, send as control sequence (dangerous)."
    },
    "multiline": {
      "type": "boolean",
      "default": false,
      "description": "If true, text contains multiple lines (dangerous)."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index", "text"]
}
```

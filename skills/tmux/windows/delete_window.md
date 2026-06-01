---
enabled: true
---

# Delete Window

Delete a tmux window and all its panes. This is destructive and requires confirmation.
All processes running in the window's panes will be terminated.

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
      "description": "Window name or index to delete."
    }
  },
  "required": ["target_name", "session_name", "window_name"]
}
```

---
enabled: true
---

# Analyze Session

Run Tmux Analysis for all windows in a session using the active AI provider.

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
      "description": "Session name to analyze."
    }
  },
  "required": ["target_name", "session_name"]
}
```

---
enabled: true
---

# Create Session

Create a new tmux session on a target connection.

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
      "description": "Name for the new session."
    }
  },
  "required": ["target_name", "session_name"]
}
```

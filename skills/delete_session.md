---
enabled: true
---

# Delete Session

Delete a tmux session. WARNING: This is a destructive operation that requires confirmation.

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
      "description": "Session to delete."
    }
  },
  "required": ["target_name", "session_name"]
}
```

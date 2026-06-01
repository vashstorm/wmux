---
enabled: true
---

# Rename Session

Rename an existing tmux session.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
    },
    "old_name": {
      "type": "string",
      "description": "Current session name."
    },
    "new_name": {
      "type": "string",
      "description": "New session name."
    }
  },
  "required": ["target_name", "old_name", "new_name"]
}
```

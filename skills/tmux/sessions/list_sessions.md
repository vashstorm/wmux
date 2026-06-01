---
enabled: true
---

# List Sessions

List all tmux sessions for a target connection.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
    }
  },
  "required": ["target_name"]
}
```

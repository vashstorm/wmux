---
enabled: true
---

# List Tmux Analysis

List Tmux Analysis usage events and summary metrics.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "integer",
      "default": 50,
      "description": "Maximum events to return, up to 200."
    },
    "project_id": {
      "type": "string",
      "description": "Optional project ID filter."
    },
    "status": {
      "type": "string",
      "enum": ["success", "error"],
      "description": "Optional status filter."
    }
  }
}
```

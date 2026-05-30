---
enabled: true
---

# Invoke Backend Route

Invoke a backend REST API route. Only read-only routes are allowed for safety.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "route_id": {
      "type": "string",
      "enum": [
        "sessions.list",
        "sessions.create",
        "sessions.rename",
        "sessions.delete",
        "windows.list",
        "windows.create",
        "windows.rename",
        "windows.delete",
        "panes.list",
        "panes.split",
        "panes.delete"
      ],
      "description": "Backend route to invoke (allowlist enforced)."
    },
    "params": {
      "type": "object",
      "description": "Route-specific parameters (e.g., target_name, session_name).",
      "additionalProperties": true
    }
  },
  "required": ["route_id"]
}
```

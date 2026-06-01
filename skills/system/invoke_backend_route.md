---
enabled: true
---

# Invoke Backend Route

Invoke an allowlisted backend REST API route. Write or destructive routes may require confirmation.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "route_id": {
      "type": "string",
      "enum": [
        "connections.list",
        "sessions.list",
        "sessions.create",
        "sessions.rename",
        "sessions.delete",
        "sessions.analyze",
        "windows.list",
        "windows.create",
        "windows.delete",
        "panes.list",
        "panes.split",
        "panes.delete",
        "projects.list",
        "projects.create",
        "projects.update",
        "projects.delete",
        "projects.launch",
        "projects.sync_from_tmux",
        "projects.generate_ai_html",
        "tmux_analysis.list",
        "tmux_analysis.cleanup",
        "ai_logs.list",
        "ai_logs.clear"
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

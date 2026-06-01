---
id: invoke_backend_route
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
---
id: get_config
enabled: true
---

# Get Config

Read the current server configuration. Auth token fields are redacted in the response for security.

## Parameters

```json
{
  "type": "object",
  "properties": {}
}
```
---
id: check_health
enabled: true
---

# Check Health

Check backend server health and tmux connection availability.
Safe read-only diagnostic. Optionally check a specific connection target.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name to check. Omit to check the server health only."
    }
  }
}
```

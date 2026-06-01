---
id: navigate_frontend
enabled: true
---

# Navigate Frontend

Navigate the frontend UI to a specific page. Allowed routes: home, settings, projects, connections, session, window, pane, stats, ai_logs.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "route": {
      "type": "string",
      "enum": ["home", "settings", "projects", "connections", "session", "window", "pane", "stats", "ai_logs"],
      "description": "Target frontend route/page."
    }
  },
  "required": ["route"]
}
```
---
id: get_current_focus
enabled: true
---

# Get Current Focus

Read the currently focused connection, session, window, and pane from the UI state.
Use this before other commands when you need to know what the user is looking at.
Returns target_name, session_name, window_name, and pane_index.

## Parameters

```json
{
  "type": "object",
  "properties": {}
}
```

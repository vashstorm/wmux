---
id: navigate_frontend
enabled: true
---

# Navigate Frontend

Navigate the frontend UI to a specific page or focused workspace item.
Allowed routes: home, settings, projects, connections, session, window, pane, stats, ai_logs.

Use route `session`, `window`, or `pane` with target/session/window/pane parameters to select a tmux workspace.
Use route `projects` with `project_id`, `project_name`, or `session_name` to open a specific project.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "route": {
      "type": "string",
      "enum": ["home", "settings", "projects", "connections", "session", "window", "pane", "stats", "ai_logs"],
      "description": "Target frontend route/page."
    },
    "target_name": {
      "type": "string",
      "description": "Target connection name when selecting a session, window, or pane. Defaults to current focus when omitted."
    },
    "session_name": {
      "type": "string",
      "description": "Session name to select for session/window/pane navigation, or project-associated session for project lookup."
    },
    "window_name": {
      "type": "string",
      "description": "Window ID, name, or index to select for window/pane navigation."
    },
    "pane_index": {
      "type": "string",
      "description": "Pane ID or index to select for pane navigation."
    },
    "project_id": {
      "type": "string",
      "description": "Project ID to open when route is projects."
    },
    "project_name": {
      "type": "string",
      "description": "Project name to open when route is projects."
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

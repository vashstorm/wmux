---
enabled: true
---

# Navigate Frontend

Navigate the frontend UI to a specific page. Allowed routes: home, settings, projects, connections, session, window, pane.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "route": {
      "type": "string",
      "enum": ["home", "settings", "projects", "connections", "session", "window", "pane"],
      "description": "Target frontend route/page."
    }
  },
  "required": ["route"]
}
```

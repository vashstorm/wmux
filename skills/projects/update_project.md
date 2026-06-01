---
enabled: true
---

# Update Project

Update a saved project entry. Only include fields the user wants to change.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "project_id": {
      "type": "string",
      "description": "Project ID to update."
    },
    "name": {
      "type": "string",
      "description": "Updated project name."
    },
    "path": {
      "type": "string",
      "description": "Updated project path."
    },
    "description": {
      "type": "string",
      "description": "Updated project description."
    },
    "session_name": {
      "type": "string",
      "description": "Updated tmux session name."
    },
    "workdir": {
      "type": "string",
      "description": "Updated working directory."
    }
  },
  "required": ["project_id"]
}
```

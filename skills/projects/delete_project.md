---
enabled: true
---

# Delete Project

Delete a saved project entry. This is destructive and requires confirmation.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "project_id": {
      "type": "string",
      "description": "Project ID to delete."
    },
    "kill_session": {
      "type": "boolean",
      "default": false,
      "description": "Also terminate the associated tmux session."
    }
  },
  "required": ["project_id"]
}
```

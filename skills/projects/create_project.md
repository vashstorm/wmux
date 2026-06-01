---
enabled: true
---

# Create Project

Create a saved project entry that can be launched or synced with tmux.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Project name."
    },
    "path": {
      "type": "string",
      "description": "Project path."
    },
    "description": {
      "type": "string",
      "description": "Project description."
    },
    "session_name": {
      "type": "string",
      "description": "Optional tmux session name. Defaults to the project name."
    },
    "workdir": {
      "type": "string",
      "description": "Optional working directory."
    }
  },
  "required": ["name"]
}
```

---
enabled: true
---

# Run Project

Change directory to a project path and run its start command inside a tmux pane.
This is a high-level workflow skill that sends two sequential commands: cd and then the start command.
Requires confirmation before executing since it runs commands in the terminal.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server."
    },
    "session_name": {
      "type": "string",
      "description": "Session name."
    },
    "window_name": {
      "type": "string",
      "description": "Window name or index."
    },
    "pane_index": {
      "type": "string",
      "description": "Pane index or ID to run the project in."
    },
    "project_path": {
      "type": "string",
      "description": "Absolute path to the project directory."
    },
    "start_command": {
      "type": "string",
      "description": "Command to run, e.g. 'npm run dev', 'cargo run', 'make run'."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index", "project_path", "start_command"]
}
```

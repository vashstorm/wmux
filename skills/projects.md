---
id: list_projects
enabled: true
---

# List Projects

List saved projects and their associated tmux session status.

## Parameters

```json
{
  "type": "object",
  "properties": {}
}
```
---
id: create_project
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
---
id: update_project
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
---
id: delete_project
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
---
id: launch_project
enabled: true
---

# Launch Project

Launch or recreate a project's tmux layout.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "project_id": {
      "type": "string",
      "description": "Project ID to launch."
    }
  },
  "required": ["project_id"]
}
```
---
id: sync_project_from_tmux
enabled: true
---

# Sync Project From Tmux

Capture the current tmux session layout into a saved project.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "project_id": {
      "type": "string",
      "description": "Project ID to sync."
    }
  },
  "required": ["project_id"]
}
```
---
id: generate_project_ai_html
enabled: true
---

# Generate Project AI HTML

Generate an AI HTML summary for a project dashboard using the active AI provider.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "project_id": {
      "type": "string",
      "description": "Project ID to analyze."
    }
  },
  "required": ["project_id"]
}
```
---
id: run_project
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

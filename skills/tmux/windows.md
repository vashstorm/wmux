---
id: create_window
enabled: true
---

# Create Window

Create a new tmux window inside an existing session.

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
      "description": "Session name to create the window in."
    },
    "window_name": {
      "type": "string",
      "description": "Name for the new window."
    }
  },
  "required": ["target_name", "session_name", "window_name"]
}
```
---
id: rename_window
enabled: true
---

# Rename Window

Rename an existing tmux window by its current name or index.

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
      "description": "Session name containing the window."
    },
    "window_name": {
      "type": "string",
      "description": "Current window name or index."
    },
    "new_name": {
      "type": "string",
      "description": "New name for the window."
    }
  },
  "required": ["target_name", "session_name", "window_name", "new_name"]
}
```
---
id: delete_window
enabled: true
---

# Delete Window

Delete a tmux window and all its panes. This is destructive and requires confirmation.
All processes running in the window's panes will be terminated.

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
      "description": "Session name containing the window."
    },
    "window_name": {
      "type": "string",
      "description": "Window name or index to delete."
    }
  },
  "required": ["target_name", "session_name", "window_name"]
}
```

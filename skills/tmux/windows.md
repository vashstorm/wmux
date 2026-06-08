---
id: switch_window
enabled: true
---

# Switch Window

Switch the UI focus to a tmux window inside an existing session.
Use this for requests like "switch to the second window", "切换到第二个窗口", or "打开 editor window".
When the user says "the Nth window" or "第 N 个 window", put N in `window_index` as a 1-based ordinal in the current UI order.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server. Defaults to the current focus when omitted."
    },
    "session_name": {
      "type": "string",
      "description": "Session name containing the window. Defaults to the current focused session when omitted by the user."
    },
    "window_name": {
      "type": "string",
      "description": "Window ID or exact window name to select."
    },
    "window_index": {
      "type": "integer",
      "minimum": 1,
      "description": "1-based ordinal for commands like 'the second window' or '第二个窗口'."
    }
  },
  "required": ["session_name"]
}
```
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
      "description": "Current window ID, exact name, tmux display index, or ordinal text such as '第二个'."
    },
    "window_index": {
      "type": "integer",
      "minimum": 1,
      "description": "1-based ordinal in the current UI order for commands like 'rename the second window'."
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
      "description": "Window ID, exact name, tmux display index, or ordinal text such as '第二个' to delete."
    },
    "window_index": {
      "type": "integer",
      "minimum": 1,
      "description": "1-based ordinal in the current UI order for commands like 'delete the second window' or '删除第二个 window'."
    }
  },
  "required": ["target_name", "session_name"]
}
```

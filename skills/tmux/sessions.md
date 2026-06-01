---
id: list_sessions
enabled: true
---

# List Sessions

List all tmux sessions for a target connection.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
    }
  },
  "required": ["target_name"]
}
```
---
id: create_session
enabled: true
---

# Create Session

Create a new tmux session on a target connection.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
    },
    "session_name": {
      "type": "string",
      "description": "Name for the new session."
    }
  },
  "required": ["target_name", "session_name"]
}
```
---
id: rename_session
enabled: true
---

# Rename Session

Rename an existing tmux session.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
    },
    "old_name": {
      "type": "string",
      "description": "Current session name."
    },
    "new_name": {
      "type": "string",
      "description": "New session name."
    }
  },
  "required": ["target_name", "old_name", "new_name"]
}
```
---
id: delete_session
enabled: true
---

# Delete Session

Delete a tmux session. WARNING: This is a destructive operation that requires confirmation.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
    },
    "session_name": {
      "type": "string",
      "description": "Session to delete."
    }
  },
  "required": ["target_name", "session_name"]
}
```

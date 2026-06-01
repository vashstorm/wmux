---
id: focus_pane
enabled: true
---

# Focus Pane

Switch the UI focus to a specific session, window, and pane without sending any input.
Use this to navigate the user's view without executing commands.

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
      "description": "Pane index or ID to focus."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index"]
}
```
---
id: read_pane_output
enabled: true
---

# Read Pane Output

Read the last N lines of visible output from a tmux pane for context.
Useful to understand what is running or what happened before taking action.
Lines default to 50, maximum 500.

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
      "description": "Pane index or ID within the window."
    },
    "lines": {
      "type": "integer",
      "default": 50,
      "description": "Number of lines to capture (max 500)."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index"]
}
```
---
id: clear_pane
enabled: true
---

# Clear Pane

Clear the visible content and scroll history of a tmux pane.
Equivalent to running the clear command and clearing tmux scroll history.

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
      "description": "Pane index or ID to clear."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index"]
}
```
---
id: split_pane
enabled: true
---

# Split Pane

Split a tmux pane horizontally or vertically to create a new pane in the same window.
Horizontal splits create a pane to the right; vertical splits create a pane below.

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
      "description": "Pane index or ID to split."
    },
    "horizontal": {
      "type": "boolean",
      "default": false,
      "description": "If true, split horizontally (side by side). If false, split vertically (top/bottom)."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index"]
}
```
---
id: send_to_pane
enabled: true
---

# Send To Pane

Send text or commands to a tmux pane. WARNING: With execute=true, append_enter=true, control=true, or multiline=true, this is dangerous and requires confirmation.

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
      "description": "Session name."
    },
    "window_name": {
      "type": "string",
      "description": "Window name or index."
    },
    "pane_index": {
      "type": "string",
      "description": "Pane index or tmux pane ID within the window."
    },
    "text": {
      "type": "string",
      "description": "Text to send to the pane, or a tmux key name when control is true."
    },
    "execute": {
      "type": "boolean",
      "default": false,
      "description": "If true, execute as command (dangerous)."
    },
    "append_enter": {
      "type": "boolean",
      "default": false,
      "description": "If true, append Enter key after text (dangerous)."
    },
    "control": {
      "type": "boolean",
      "default": false,
      "description": "If true, interpret text as a tmux key/control sequence (dangerous)."
    },
    "control_sequence": {
      "type": "string",
      "description": "Optional tmux key/control sequence to send instead of text (dangerous)."
    },
    "multiline": {
      "type": "boolean",
      "default": false,
      "description": "If true, text contains multiple lines (dangerous)."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index", "text"]
}
```
---
id: kill_pane
enabled: true
---

# Kill Pane

Kill a specific tmux pane, terminating any process running inside it. This is destructive and requires confirmation.

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
      "description": "Pane index or ID to kill."
    }
  },
  "required": ["target_name", "session_name", "window_name", "pane_index"]
}
```

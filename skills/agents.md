---
id: run_claude_prompt
enabled: true
---

# Run Claude Prompt

Run `claude -p "<prompt>"` in a tmux pane. Use this when the user asks Omni to execute a Claude Code request, for example "claude review this file" or "ask Claude to explain the error".
This writes to a terminal and requires confirmation before executing.
If target fields are omitted, use the current focused tmux pane from session context.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "Prompt text to pass to the claude CLI."
    },
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server."
    },
    "session_name": {
      "type": "string",
      "description": "Session name. Omit to use the current focused session."
    },
    "window_name": {
      "type": "string",
      "description": "Window name, index, or ID. Omit to use the current focused window."
    },
    "pane_index": {
      "type": "string",
      "description": "Pane index or ID. Omit to use the current focused pane."
    }
  },
  "required": ["prompt"]
}
```
---
id: run_codex_prompt
enabled: true
---

# Run Codex Prompt

Run `codex exec "<prompt>"` in a tmux pane. Use this when the user asks Omni to execute a Codex request, for example "codex fix the failing test" or "ask Codex to summarize this repo".
This writes to a terminal and requires confirmation before executing.
If target fields are omitted, use the current focused tmux pane from session context.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "Prompt text to pass to the codex CLI."
    },
    "target_name": {
      "type": "string",
      "description": "Target connection name. Use 'local' for the local tmux server."
    },
    "session_name": {
      "type": "string",
      "description": "Session name. Omit to use the current focused session."
    },
    "window_name": {
      "type": "string",
      "description": "Window name, index, or ID. Omit to use the current focused window."
    },
    "pane_index": {
      "type": "string",
      "description": "Pane index or ID. Omit to use the current focused pane."
    }
  },
  "required": ["prompt"]
}
```

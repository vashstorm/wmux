---
id: list_ai_logs
enabled: true
---

# List AI Logs

List AI Logs entries for recent model prompts, tool calls, tool results, and errors.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "integer",
      "default": 50,
      "description": "Maximum logs to return."
    },
    "before": {
      "type": "string",
      "description": "Optional RFC3339 cursor for pagination."
    }
  }
}
```
---
id: clear_ai_logs
enabled: true
---

# Clear AI Logs

Clear all AI Logs entries. This is destructive and requires confirmation.

## Parameters

```json
{
  "type": "object",
  "properties": {}
}
```

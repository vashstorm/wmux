---
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

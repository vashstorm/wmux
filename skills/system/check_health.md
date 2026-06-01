---
enabled: true
---

# Check Health

Check backend server health and tmux connection availability.
Safe read-only diagnostic. Optionally check a specific connection target.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "target_name": {
      "type": "string",
      "description": "Target connection name to check. Omit to check the server health only."
    }
  }
}
```

---
enabled: true
---

# Cancel Action

Cancel a pending dangerous action using the confirmation ID.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "confirmation_id": {
      "type": "string",
      "format": "uuid",
      "description": "Confirmation ID to cancel."
    }
  },
  "required": ["confirmation_id"]
}
```

---
id: confirm_action
enabled: true
---

# Confirm Action

Confirm a pending dangerous action using the confirmation ID provided by the intent_received event.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "confirmation_id": {
      "type": "string",
      "format": "uuid",
      "description": "Confirmation ID from intent_received event."
    }
  },
  "required": ["confirmation_id"]
}
```
---
id: cancel_action
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

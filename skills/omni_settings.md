---
id: toggle_omni
enabled: true
---

# Toggle Omni

Enable or disable the Omni voice assistant.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "enabled": {
      "type": "boolean",
      "description": "Whether to enable or disable Omni."
    }
  },
  "required": ["enabled"]
}
```
---
id: set_voice
enabled: true
---

# Set Voice

Switch the Omni voice character (e.g., "Cindy", "Andy", "Emily").

## Parameters

```json
{
  "type": "object",
  "properties": {
    "voice": {
      "type": "string",
      "description": "Voice character name."
    }
  },
  "required": ["voice"]
}
```
---
id: toggle_continuous_listening
enabled: true
---

# Toggle Continuous Listening

Enable or disable continuous voice listening mode.
When enabled, Omni listens continuously without needing to press a button.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "enabled": {
      "type": "boolean",
      "description": "Whether to enable or disable continuous listening."
    }
  },
  "required": ["enabled"]
}
```
---
id: toggle_vad
enabled: true
---

# Toggle VAD

Enable or disable Voice Activity Detection (VAD).
VAD automatically detects when you start speaking.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "enabled": {
      "type": "boolean",
      "description": "Whether to enable or disable VAD."
    },
    "threshold": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 1.0,
      "description": "VAD sensitivity threshold (optional, defaults to 0.5)."
    }
  }
}
```
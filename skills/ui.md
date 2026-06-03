---
id: set_theme
enabled: true
---

# Set Theme

Switch between light and dark theme for the application UI.
This setting affects both the main UI and the terminal window theme.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "theme": {
      "type": "string",
      "enum": ["light", "dark"],
      "description": "Target theme to apply."
    }
  },
  "required": ["theme"]
}
```
---
id: set_font_size
enabled: true
---

# Set Font Size

Adjust the UI font size for menus, labels, and panel tabs.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "size": {
      "type": "integer",
      "minimum": 12,
      "maximum": 24,
      "description": "Font size in pixels."
    }
  },
  "required": ["size"]
}
```
---
id: set_terminal_font
enabled: true
---

# Set Terminal Font

Adjust the terminal's font size and weight.

## Parameters

```json
{
  "type": "object",
  "properties": {
    "fontSize": {
      "type": "integer",
      "minimum": 10,
      "maximum": 28,
      "description": "Terminal font size in pixels."
    },
    "fontWeight": {
      "type": "string",
      "enum": ["normal", "bold", "500", "600"],
      "description": "Terminal font weight."
    }
  },
  "required": ["fontSize"]
}
```
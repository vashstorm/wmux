import type { ITheme } from "@xterm/xterm"

export interface ThemeOption {
  id: string
  mode: "dark" | "light"
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "light", mode: "light" },
  { id: "dark", mode: "dark" },
]

export const DEFAULT_THEME_ID = "light"

export const TERMINAL_THEMES: Record<string, ITheme> = {
  dark: {
    background: "#161719",
    foreground: "#f2eeeb",
    cursor: "#db8e3b",
    cursorAccent: "#161719",
    selectionBackground: "rgba(219, 142, 59, 0.25)",
    black: "#202124",
    red: "#ea5a4b",
    green: "#a7c080",
    yellow: "#db8e3b",
    blue: "#7daea3",
    magenta: "#d3869b",
    cyan: "#89b482",
    white: "#dfdfdf",
    brightBlack: "#665c54",
    brightRed: "#ea5a4b",
    brightGreen: "#a7c080",
    brightYellow: "#db8e3b",
    brightBlue: "#7daea3",
    brightMagenta: "#d3869b",
    brightCyan: "#89b482",
    brightWhite: "#f2eeeb",
  },
  light: {
    background: "#fdfcf9",
    foreground: "#2b2621",
    cursor: "#b85a3c",
    selectionBackground: "rgba(184, 90, 60, 0.2)",
    black: "#2b2621",
    red: "#c94a3b",
    green: "#5f8745",
    yellow: "#cf9c34",
    blue: "#3f6a8a",
    magenta: "#8d5b8c",
    cyan: "#4b8c9c",
    white: "#eae4d8",
    brightBlack: "#5f544b",
    brightRed: "#e75b4c",
    brightGreen: "#799e5a",
    brightYellow: "#dfb050",
    brightBlue: "#5583a5",
    brightMagenta: "#a473a3",
    brightCyan: "#65a5b5",
    brightWhite: "#fdfcf9",
  },
}

const VALID_THEME_IDS = new Set(["light", "dark"])

export function isThemeId(value: string | undefined | null): value is "light" | "dark" {
  return value === "light" || value === "dark"
}

export function normalizeThemeId(
  value: string | undefined | null,
  fallback = DEFAULT_THEME_ID,
): string {
  // Legacy/unknown theme IDs normalize to fallback or DEFAULT_THEME_ID
  if (isThemeId(value)) return value
  if (isThemeId(fallback)) return fallback
  return DEFAULT_THEME_ID
}

export function getTerminalTheme(themeId: string | undefined | null): ITheme {
  const normalizedThemeId = normalizeThemeId(themeId)
  const theme = TERMINAL_THEMES[normalizedThemeId]
  if (theme) {
    return theme
  }
  return TERMINAL_THEMES[DEFAULT_THEME_ID] as ITheme
}

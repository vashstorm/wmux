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
    background: "#0a0e1a",
    foreground: "#f8fafc",
    cursor: "#f59e0b",
    cursorAccent: "#0a0e1a",
    selectionBackground: "rgba(245, 158, 11, 0.2)",
    black: "#0f172a",
    red: "#ef4444",
    green: "#10b981",
    yellow: "#f59e0b",
    blue: "#8b5cf6",
    magenta: "#a855f7",
    cyan: "#06b6d4",
    white: "#f8fafc",
    brightBlack: "#334155",
    brightRed: "#f87171",
    brightGreen: "#34d399",
    brightYellow: "#fbbf24",
    brightBlue: "#a78bfa",
    brightMagenta: "#c084fc",
    brightCyan: "#22d3ee",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#f5f7fb",
    foreground: "#111827",
    cursor: "#4f6bed",
    selectionBackground: "#dde5ff",
    black: "#f5f7fb",
    red: "#d13438",
    green: "#1f8a5b",
    yellow: "#b7791f",
    blue: "#4f6bed",
    magenta: "#8b5cf6",
    cyan: "#0f8aa7",
    white: "#111827",
    brightBlack: "#8b96a8",
    brightRed: "#ff3b30",
    brightGreen: "#30d158",
    brightYellow: "#ff9f0a",
    brightBlue: "#7c8ff7",
    brightMagenta: "#af52de",
    brightCyan: "#5ac8fa",
    brightWhite: "#374151",
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

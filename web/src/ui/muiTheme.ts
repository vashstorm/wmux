import { createTheme, type Theme } from "@mui/material/styles"
import { useMemo } from "react"

export type ThemeMode = "light" | "dark"

const SHAPE = { borderRadius: 8 }

const TYPOGRAPHY = {
  fontFamily:
    "'Inter', 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  h1: { fontSize: "var(--font-size-3xl)", fontWeight: 700, lineHeight: 1.15, letterSpacing: "0" },
  h2: { fontSize: "var(--font-size-2xl)", fontWeight: 700, lineHeight: 1.18, letterSpacing: "0" },
  h3: { fontSize: "var(--font-size-xl)", fontWeight: 600, lineHeight: 1.22, letterSpacing: "0" },
  h4: { fontSize: "var(--font-size-lg)", fontWeight: 600, lineHeight: 1.25, letterSpacing: "0" },
  h5: { fontSize: "var(--font-size-base)", fontWeight: 600, lineHeight: 1.3, letterSpacing: "0" },
  h6: { fontSize: "var(--font-size-md)", fontWeight: 600, lineHeight: 1.35, letterSpacing: "0" },
  subtitle1: {
    fontSize: "var(--font-size-base)",
    fontWeight: 600,
    lineHeight: 1.35,
    letterSpacing: "0",
  },
  subtitle2: {
    fontSize: "var(--font-size-md)",
    fontWeight: 600,
    lineHeight: 1.35,
    letterSpacing: "0",
  },
  body1: {
    fontSize: "var(--font-size-base)",
    lineHeight: "var(--line-height-normal)",
    letterSpacing: "0",
  },
  body2: {
    fontSize: "var(--font-size-sm)",
    lineHeight: "var(--line-height-normal)",
    letterSpacing: "0",
  },
  caption: { fontSize: "var(--font-size-xs)", lineHeight: 1.35, letterSpacing: "0" },
  button: {
    fontSize: "var(--font-size-sm)",
    lineHeight: 1.3,
    textTransform: "none" as const,
    fontWeight: 600,
    letterSpacing: "0",
  },
}

function makeComponentOverrides(mode: ThemeMode, palette: Theme["palette"]): Theme["components"] {
  const isDark = mode === "dark"
  return {
    MuiCssBaseline: {
      styleOverrides: {
        "*": {
          boxSizing: "border-box",
          scrollbarWidth: "thin",
          scrollbarColor: isDark
            ? "rgba(255,255,255,0.12) transparent"
            : "rgba(0,0,0,0.14) transparent",
        },
        "*::before": { boxSizing: "border-box" },
        "*::after": { boxSizing: "border-box" },
        "::-webkit-scrollbar": { width: "6px", height: "6px" },
        "::-webkit-scrollbar-track": { background: "transparent" },
        "::-webkit-scrollbar-thumb": {
          background: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.14)",
          borderRadius: "999px",
          "&:hover": {
            background: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.22)",
          },
        },
        "html, body": { height: "100%", overflow: "hidden" },
        "#root": { height: "100%", overflow: "hidden" },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
          ...(isDark && {
            backgroundImage: "linear-gradient(rgba(255,255,255,0.03), rgba(255,255,255,0))",
          }),
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, disableRipple: false },
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          lineHeight: 1.3,
          transition: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
        },
        contained: {
          "&:hover": {
            transform: "translateY(-1px)",
            boxShadow: `${palette.primary.main}33 0 4px 12px`,
          },
          "&:active": { transform: "translateY(0)" },
        },
        outlined: {
          "&:hover": {
            backgroundColor: isDark ? "rgba(107,130,245,0.08)" : "rgba(79,107,237,0.06)",
          },
        },
      },
    },
    MuiIconButton: {
      defaultProps: { disableRipple: false },
      styleOverrides: {
        root: {
          borderRadius: 8,
          transition: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
          "&:hover": {
            backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
          },
        },
      },
    },
    MuiTab: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          minHeight: 36,
          height: 36,
          borderRadius: 8,
          transition: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
          fontSize: "var(--font-size-sm)",
          fontWeight: 500,
          textTransform: "none",
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: "unset" },
        indicator: { display: "none" },
      },
    },
    MuiTextField: {
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 8,
            fontSize: "var(--font-size-sm)",
            lineHeight: "var(--line-height-normal)",
            transition: "box-shadow 150ms ease",
            "&.Mui-focused": {
              boxShadow: `0 0 0 3px ${palette.primary.main}24`,
            },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontSize: "var(--font-size-xs)",
          fontWeight: 600,
          lineHeight: 1.2,
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: "var(--font-size-sm)",
          lineHeight: 1.35,
        },
      },
    },
    MuiFormControlLabel: {
      styleOverrides: {
        label: {
          fontSize: "var(--font-size-sm)",
          lineHeight: 1.35,
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: "var(--font-size-sm)",
          lineHeight: "var(--line-height-normal)",
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontSize: "var(--font-size-xs)",
          lineHeight: 1.35,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          backgroundColor: isDark ? "rgba(22, 27, 34, 0.82)" : "rgba(255, 255, 255, 0.88)",
          border: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)",
          boxShadow: isDark
            ? "0 24px 48px rgba(0,0,0,0.5), 0 0 1px 1px rgba(255,255,255,0.1)"
            : "0 24px 48px rgba(15,23,42,0.12), 0 0 1px 1px rgba(0,0,0,0.04)",
          backgroundImage: "none",
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: { fontWeight: 600, fontSize: "var(--font-size-lg)" },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          transition: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { opacity: isDark ? 0.12 : 0.1 },
      },
    },
  }
}

export function createAppTheme(mode: ThemeMode): Theme {
  const isDark = mode === "dark"

  // Define palette first so we can use it in component overrides
  const primaryMain = isDark ? "#6b82f5" : "#4f6bed"
  const primaryLight = isDark ? "#9aa8fb" : "#7c8ff7"
  const primaryDark = isDark ? "#5568df" : "#3d57d6"

  const backgroundDefault = isDark ? "#0d1117" : "#f7f8fb"
  const backgroundPaper = isDark ? "#161b22" : "#ffffff"

  const base = createTheme({
    palette: {
      mode,
      primary: {
        main: primaryMain,
        light: primaryLight,
        dark: primaryDark,
        contrastText: "#ffffff",
      },
      secondary: {
        main: isDark ? "#f59e0b" : "#f59e0b",
        light: isDark ? "#fbbf24" : "#fbbf24",
        dark: isDark ? "#d97706" : "#d97706",
        contrastText: isDark ? "#0d1117" : "#ffffff",
      },
      error: {
        main: isDark ? "#ef4444" : "#dc2626",
        light: isDark ? "#f87171" : "#ef4444",
      },
      warning: {
        main: isDark ? "#f59e0b" : "#d97706",
      },
      success: {
        main: isDark ? "#10b981" : "#059669",
      },
      background: {
        default: backgroundDefault,
        paper: backgroundPaper,
      },
      text: {
        primary: isDark ? "#f1f5f9" : "#0f172a",
        secondary: isDark ? "#94a3b8" : "#475569",
        disabled: isDark ? "#475569" : "#94a3b8",
      },
      divider: isDark ? "rgba(255,255,255,0.08)" : "rgba(15, 23, 42, 0.08)",
      action: {
        hover: isDark ? "rgba(255,255,255,0.05)" : "rgba(15, 23, 42, 0.04)",
        selected: isDark ? "rgba(107,130,245,0.16)" : "rgba(79,107,237,0.08)",
        disabled: isDark ? "rgba(255,255,255,0.26)" : "rgba(0,0,0,0.26)",
        disabledBackground: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
      },
    },
    typography: TYPOGRAPHY,
    shape: SHAPE,
  })

  return createTheme(base, {
    components: makeComponentOverrides(mode, base.palette),
  })
}

export function useModeTheme(themeId: string): Theme {
  return useMemo(() => {
    const mode: ThemeMode = themeId === "dark" ? "dark" : "light"
    return createAppTheme(mode)
  }, [themeId])
}

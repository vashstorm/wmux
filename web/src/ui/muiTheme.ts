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
            ? "rgba(242,238,235,0.2) rgba(0,0,0,0.2)"
            : "rgba(43,38,33,0.25) rgba(43,38,33,0.05)",
        },
        "*::before": { boxSizing: "border-box" },
        "*::after": { boxSizing: "border-box" },
        "::-webkit-scrollbar": { width: "6px", height: "6px" },
        "::-webkit-scrollbar-track": { background: "var(--color-scrollbar-track)" },
        "::-webkit-scrollbar-thumb": {
          background: "var(--color-scrollbar-thumb)",
          borderRadius: "var(--radius-sm)",
          "&:hover": {
            filter: "brightness(0.9)",
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
        },
        outlined: {
          borderColor: "var(--color-panel-border)",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          borderRadius: "var(--radius-md)",
          borderColor: "var(--color-panel-border)",
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, disableRipple: false },
      styleOverrides: {
        root: {
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          lineHeight: 1.3,
          border: "2px solid var(--color-text)",
          transition: "all var(--transition-fast)",
        },
        contained: {
          boxShadow: "var(--shadow-sm)",
          "&:hover": {
            transform: "translate(-1px, -1px)",
            boxShadow: "var(--shadow-md)",
            backgroundColor: palette.primary.dark,
          },
          "&:active": {
            transform: "translate(1px, 1px)",
            boxShadow: "none",
          },
        },
        outlined: {
          boxShadow: "var(--shadow-sm)",
          "&:hover": {
            border: "2px solid var(--color-text)",
            backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
            transform: "translate(-1px, -1px)",
            boxShadow: "var(--shadow-md)",
          },
          "&:active": {
            transform: "translate(1px, 1px)",
            boxShadow: "none",
          },
        },
        sizeSmall: {
          fontSize: "var(--font-size-xs)",
          padding: "2px var(--spacing-sm)",
          minHeight: 28,
        },
        sizeMedium: {
          fontSize: "var(--font-size-sm)",
          padding: "4px var(--spacing-md)",
          minHeight: 34,
        },
        sizeLarge: {
          fontSize: "var(--font-size-base)",
          padding: "6px var(--spacing-lg)",
          minHeight: 40,
        },
      },
    },
    MuiIconButton: {
      defaultProps: { disableRipple: false },
      styleOverrides: {
        root: {
          borderRadius: "var(--radius-sm)",
          border: "1px solid transparent",
          transition: "all var(--transition-fast)",
          "&:hover": {
            borderColor: "var(--color-panel-border)",
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
          borderRadius: "var(--radius-sm)",
          transition: "all var(--transition-fast)",
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
            borderRadius: "var(--radius-input)",
            fontSize: "var(--font-size-sm)",
            lineHeight: "var(--line-height-normal)",
            boxShadow: "var(--shadow-inner)",
            transition: "all var(--transition-base)",
            "& fieldset": {
              border: "2px solid var(--color-input-border) !important",
            },
            "&.Mui-focused fieldset": {
              borderColor: "var(--color-input-border-focus) !important",
            },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--font-size-xs)",
          fontWeight: 600,
          lineHeight: 1.2,
          border: "1px solid var(--color-panel-border)",
        },
        sizeSmall: {
          height: 22,
          padding: "0 var(--spacing-xs)",
          fontSize: "var(--font-size-2xs)",
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
          border: "1px solid var(--color-panel-border)",
          borderRadius: "var(--radius-sm)",
          backgroundColor: isDark ? "#202124" : "#fdfcf9",
          color: "var(--color-text)",
          boxShadow: "var(--shadow-sm)",
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: "var(--radius-md)",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          backgroundColor: isDark ? "#202124" : "#fdfcf9",
          border: "2px solid var(--color-panel-border)",
          boxShadow: "var(--shadow-lg)",
          backgroundImage: "none",
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: { fontWeight: 600, fontSize: "var(--font-size-lg)" },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: "var(--spacing-md) var(--spacing-lg)",
          gap: "var(--spacing-sm)",
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: "var(--radius-sm)",
          transition: "all var(--transition-fast)",
          "&.Mui-selected": {
            backgroundColor: "var(--color-accent-subtle)",
            "&:hover": {
              backgroundColor: "var(--color-surface-hover)",
            },
          },
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: "var(--color-panel-border)", opacity: 0.5 },
      },
    },
  }
}

export function createAppTheme(mode: ThemeMode): Theme {
  const isDark = mode === "dark"

  const primaryMain = isDark ? "#db8e3b" : "#b85a3c"
  const primaryLight = isDark ? "#e79e4d" : "#cf7d63"
  const primaryDark = isDark ? "#b36f25" : "#973f24"

  const backgroundDefault = isDark ? "#161719" : "#f5f2eb"
  const backgroundPaper = isDark ? "#202124" : "#fdfcf9"

  const base = createTheme({
    palette: {
      mode,
      primary: {
        main: primaryMain,
        light: primaryLight,
        dark: primaryDark,
        contrastText: isDark ? "#161719" : "#ffffff",
      },
      secondary: {
        main: isDark ? "#db8e3b" : "#cf9c34",
        light: isDark ? "#e79e4d" : "#dfb050",
        dark: isDark ? "#b36f25" : "#a17621",
        contrastText: isDark ? "#161719" : "#ffffff",
      },
      error: {
        main: isDark ? "#ea5a4b" : "#c94a3b",
        light: isDark ? "#f28175" : "#e06557",
      },
      warning: {
        main: isDark ? "#db8e3b" : "#cf9c34",
      },
      success: {
        main: isDark ? "#a7c080" : "#5f8745",
      },
      background: {
        default: backgroundDefault,
        paper: backgroundPaper,
      },
      text: {
        primary: isDark ? "#f2eeeb" : "#2b2621",
        secondary: isDark ? "#bdae93" : "#5f544b",
        disabled: isDark ? "#665c54" : "#8a7f74",
      },
      divider: isDark ? "#a89984" : "#2b2621",
      action: {
        hover: isDark ? "rgba(255,255,255,0.06)" : "rgba(43, 38, 33, 0.05)",
        selected: isDark ? "rgba(219, 142, 59, 0.15)" : "rgba(184, 90, 60, 0.08)",
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

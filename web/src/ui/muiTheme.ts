import { createTheme, type Theme } from "@mui/material/styles";
import { useMemo } from "react";

export type ThemeMode = "light" | "dark";

const SHAPE = { borderRadius: 8 };

const TYPOGRAPHY = {
	fontFamily:
		"'Inter', 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
	h1: { fontWeight: 700, letterSpacing: "-0.02em" },
	h2: { fontWeight: 700, letterSpacing: "-0.01em" },
	h3: { fontWeight: 600, letterSpacing: "-0.01em" },
	h6: { fontWeight: 600, letterSpacing: "-0.01em" },
	subtitle1: { fontWeight: 600, letterSpacing: "0" },
	subtitle2: { fontWeight: 500, letterSpacing: "0" },
	body1: { letterSpacing: "0" },
	body2: { letterSpacing: "0" },
	caption: { letterSpacing: "0.01em" },
	button: { textTransform: "none" as const, fontWeight: 600, letterSpacing: "0.01em" },
};

function makeComponentOverrides(mode: ThemeMode, palette: Theme["palette"]): Theme["components"] {
	const isDark = mode === "dark";
	return {
		MuiCssBaseline: {
			styleOverrides: {
				"*": { boxSizing: "border-box" },
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
						backgroundImage:
							"linear-gradient(rgba(255,255,255,0.03), rgba(255,255,255,0))",
					}),
				},
			},
		},
		MuiButton: {
			defaultProps: { disableElevation: true, disableRipple: false },
			styleOverrides: {
				root: {
					borderRadius: 8,
					fontWeight: 600,
					transition: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
				},
				contained: {
					"&:hover": { transform: "translateY(-1px)", boxShadow: `${palette.primary.main}33 0 4px 12px` },
					"&:active": { transform: "translateY(0)" },
				},
				outlined: {
					"&:hover": {
						backgroundColor: isDark
							? "rgba(107,130,245,0.08)"
							: "rgba(79,107,237,0.06)",
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
						backgroundColor: isDark
							? "rgba(255,255,255,0.08)"
							: "rgba(0,0,0,0.06)",
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
				root: { borderRadius: 6 },
			},
		},
		MuiDialog: {
			styleOverrides: {
				paper: {
					borderRadius: 16,
					...(isDark && {
						backgroundImage:
							"linear-gradient(rgba(255,255,255,0.04), rgba(255,255,255,0))",
					}),
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
	};
}

export function createAppTheme(mode: ThemeMode): Theme {
	const isDark = mode === "dark";

	// Define palette first so we can use it in component overrides
	const primaryMain = isDark ? "#6b82f5" : "#4f6bed";
	const primaryLight = isDark ? "#9aa8fb" : "#7c8ff7";
	const primaryDark = isDark ? "#5568df" : "#3d57d6";

	const backgroundDefault = isDark ? "#0d1117" : "#f7f8fb";
	const backgroundPaper = isDark ? "#161b22" : "#ffffff";

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
	});

	return createTheme(base, {
		components: makeComponentOverrides(mode, base.palette),
	});
}

export function useModeTheme(themeId: string): Theme {
	return useMemo(() => {
		const mode: ThemeMode = themeId === "dark" ? "dark" : "light";
		return createAppTheme(mode);
	}, [themeId]);
}

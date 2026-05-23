import "./styles/global.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/fonts.css";

import { useEffect, useRef } from "react";
import { ThemeProvider, CssBaseline, IconButton } from "@mui/material";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import { AppProvider, useAppState } from "./state/store.js";
import { getConfig, updateConfig } from "./api/client.js";
import { applyUIScaleStep, fontSizeToScaleStep, DEFAULT_UI_SCALE_STEP, DEFAULT_TERMINAL_FONT_SIZE } from "./ui/fontSize.js";
import { useModeTheme } from "./ui/muiTheme.js";
import { MainPanel } from "./components/MainPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { NewConnectionForm } from "./components/NewConnectionForm.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ErrorLogsPanel } from "./components/ErrorLogsPanel.js";
import { ConfigConflictBanner } from "./components/ConfigConflictBanner.js";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation.js";
import { normalizeThemeId } from "./ui/themes.js";

function UISettingsInit() {
	const { setUISettings } = useAppState();

	useEffect(() => {
		void getConfig().then((config) => {
			const theme = normalizeThemeId(config.ui.theme);
			const windowTheme = normalizeThemeId(config.ui.windowTheme, theme);

			const uiScaleStep = config.ui.uiScaleStep !== undefined
				? config.ui.uiScaleStep
				: config.ui.fontSize !== undefined
					? fontSizeToScaleStep(config.ui.fontSize)
					: DEFAULT_UI_SCALE_STEP;

			const terminalFontSize = config.ui.terminalFontSize || DEFAULT_TERMINAL_FONT_SIZE;
			const terminalFontWeight = config.ui.terminalFontWeight || "normal";

			applyUIScaleStep(uiScaleStep);
			setUISettings({ theme, windowTheme, uiScaleStep, terminalFontSize, terminalFontWeight });
		}).catch(() => undefined);
	}, [setUISettings]);

	return null;
}

function MuiThemeShell({ children }: { children: React.ReactNode }) {
	const { uiSettings } = useAppState();
	const theme = useModeTheme(uiSettings.theme);

	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<div
				data-mui-color-scheme={uiSettings.theme === "dark" ? "dark" : "light"}
				style={{ display: "contents" }}
			>
				{children}
			</div>
		</ThemeProvider>
	);
}

function ThemeToggle() {
	const { uiSettings, setUISettings } = useAppState();
	const isDark = uiSettings.theme === "dark";
	const updatingRef = useRef(false);

	const handleToggle = async () => {
		if (updatingRef.current) return;
		const newTheme = isDark ? "light" : "dark";
		setUISettings({ ...uiSettings, theme: newTheme, windowTheme: newTheme });
		updatingRef.current = true;
		try {
			const config = await getConfig();
			config.ui.theme = newTheme;
			config.ui.windowTheme = newTheme;
			await updateConfig(config);
		} catch (err) {
			console.error("Failed to persist theme:", err);
		} finally {
			updatingRef.current = false;
		}
	};

	return (
		<IconButton
			data-testid="theme-toggle"
			aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
			onClick={handleToggle}
			size="small"
			sx={{ width: 30, height: 30 }}
		>
			{isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
		</IconButton>
	);
}

function WorkspaceNavigationSync() {
	useWorkspaceNavigation();
	return null;
}

export function App() {
	return (
		<AppProvider>
			<UISettingsInit />
			<WorkspaceNavigationSync />
			<MuiThemeShell>
				<div className="app-shell" data-testid="app-shell">
					<ConfigConflictBanner />
					<Sidebar themeToggle={<ThemeToggle />} />
					<MainPanel />
					<ErrorBanner />
					<ConfirmDialog />
					<NewConnectionForm />
					<SettingsPanel />
					<ErrorLogsPanel />
				</div>
			</MuiThemeShell>
		</AppProvider>
	);
}

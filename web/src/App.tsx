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
import { applyUIFontSize } from "./ui/fontSize.js";
import { useModeTheme } from "./ui/muiTheme.js";
import { MainPanel } from "./components/MainPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { NewConnectionForm } from "./components/NewConnectionForm.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ErrorLogsPanel } from "./components/ErrorLogsPanel.js";
import { ConfigConflictBanner } from "./components/ConfigConflictBanner.js";
import { normalizeThemeId } from "./ui/themes.js";

function UISettingsInit() {
	const { setUISettings } = useAppState();

	useEffect(() => {
		void getConfig().then((config) => {
			const theme = normalizeThemeId(config.ui.theme);
			const windowTheme = normalizeThemeId(config.ui.windowTheme, theme);
			const fontSize = config.ui.fontSize || 16;
			const terminalFontSize = config.ui.terminalFontSize || 14;
			const terminalFontWeight = config.ui.terminalFontWeight || "normal";

			applyUIFontSize(fontSize);
			setUISettings({ theme, windowTheme, fontSize, terminalFontSize, terminalFontWeight });
		}).catch(() => undefined);
	}, [setUISettings]);

	return null;
}

function MuiThemeShell({ children }: { children: React.ReactNode }) {
	const { uiSettings } = useAppState();
	const theme = useModeTheme(uiSettings.theme);

	return <ThemeProvider theme={theme}><CssBaseline />{children}</ThemeProvider>;
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
			sx={{ position: "fixed", top: 8, right: 8, zIndex: 9999 }}
			size="small"
		>
			{isDark ? <LightModeIcon /> : <DarkModeIcon />}
		</IconButton>
	);
}

export function App() {
	return (
		<AppProvider>
			<UISettingsInit />
			<MuiThemeShell>
				<div className="app-shell" data-testid="app-shell">
					<ThemeToggle />
					<ConfigConflictBanner />
					<Sidebar />
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

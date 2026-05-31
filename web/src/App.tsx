import "./styles/global.css";
import "./styles/layout.css";
import "./styles/overlays.css";
import "./styles/components.css";
import "./styles/fonts.css";

import { useEffect, useRef } from "react";
import { ThemeProvider, CssBaseline, IconButton, Tooltip } from "@mui/material";
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
import { AiAssistant } from "./components/AiAssistant.js";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation.js";
import { normalizeThemeId } from "./ui/themes.js";
import AssistantIcon from "@mui/icons-material/Assistant";

function UISettingsInit() {
	const { setUISettings, setOmniStatus } = useAppState();

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

			// Initialize omni/AI assistant availability so voice-launcher button
			// can render before AiAssistant mounts (avoids chicken-and-egg).
			setOmniStatus(config.omni?.enabled ? "idle" : "disabled");
		}).catch(() => undefined);
	}, [setUISettings, setOmniStatus]);

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
	const { uiSettings, setUISettings, setError } = useAppState();
	const isDark = uiSettings.theme === "dark";
	const updatingRef = useRef(false);

	const handleToggle = async () => {
		if (updatingRef.current) return;
		const newTheme = isDark ? "light" : "dark";
		setUISettings({ ...uiSettings, theme: newTheme });
		updatingRef.current = true;
		try {
			const config = await getConfig();
			config.ui.theme = newTheme;
			await updateConfig(config);
		} catch {
			setError({ code: "persist_failed", message: "Failed to persist theme" });
		} finally {
			updatingRef.current = false;
		}
	};

	const toggleLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

	return (
		<Tooltip title={toggleLabel} arrow placement="top">
			<IconButton
				data-testid="theme-toggle"
				aria-label={toggleLabel}
				onClick={handleToggle}
				size="small"
				sx={{ width: 30, height: 30 }}
			>
				{isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
			</IconButton>
		</Tooltip>
	);
}

function DarkTerminalIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
			{/* Dark terminal window */}
			<rect x="2" y="4" width="20" height="16" rx="3" fill="#0f172a" stroke="#6366f1" strokeWidth="1.5" />
			{/* Header line */}
			<path d="M2 9h20" stroke="#1e293b" strokeWidth="1.5" />
			{/* Dot indicators in header */}
			<circle cx="5" cy="6.5" r="1" fill="#ef4444" />
			<circle cx="8" cy="6.5" r="1" fill="#eab308" />
			<circle cx="11" cy="6.5" r="1" fill="#22c55e" />
			{/* Prompt `>` */}
			<path d="M6 12.5l2.5 1.5L6 15.5" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			{/* Cursor `_` */}
			<path d="M10 15.5h3" stroke="#a5b4fc" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}

function LightTerminalIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
			{/* Light terminal window */}
			<rect x="2" y="4" width="20" height="16" rx="3" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
			{/* Header line */}
			<path d="M2 9h20" stroke="#e2e8f0" strokeWidth="1.5" />
			{/* Dot indicators in header */}
			<circle cx="5" cy="6.5" r="1" fill="#cbd5e1" />
			<circle cx="8" cy="6.5" r="1" fill="#cbd5e1" />
			<circle cx="11" cy="6.5" r="1" fill="#cbd5e1" />
			{/* Prompt `>` */}
			<path d="M6 12.5l2.5 1.5L6 15.5" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			{/* Cursor `_` */}
			<path d="M10 15.5h3" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}

function TerminalThemeToggle() {
	const { uiSettings, setUISettings, setError } = useAppState();
	const isDark = uiSettings.windowTheme === "dark";
	const updatingRef = useRef(false);

	const handleToggle = async () => {
		if (updatingRef.current) return;
		const newTheme = isDark ? "light" : "dark";
		setUISettings({ ...uiSettings, windowTheme: newTheme });
		updatingRef.current = true;
		try {
			const config = await getConfig();
			config.ui.windowTheme = newTheme;
			await updateConfig(config);
		} catch {
			setError({ code: "persist_failed", message: "Failed to persist terminal theme" });
		} finally {
			updatingRef.current = false;
		}
	};

	const toggleLabel = isDark ? "Switch terminal to light" : "Switch terminal to dark";

	return (
		<Tooltip title={toggleLabel} arrow placement="top">
			<IconButton
				data-testid="terminal-theme-toggle"
				aria-label={toggleLabel}
				onClick={handleToggle}
				size="small"
				sx={{ width: 30, height: 30 }}
			>
				{isDark ? <DarkTerminalIcon /> : <LightTerminalIcon />}
			</IconButton>
		</Tooltip>
	);
}

function WorkspaceNavigationSync() {
	useWorkspaceNavigation();
	return null;
}

export function PanelVisibility() {
	const { showSettingsPanel, showErrorLogsPanel, showNewConnectionForm, editingConnection, showAiAssistant, setShowAiAssistant, omniStatus } = useAppState();

	return (
		<>
			{(showNewConnectionForm || editingConnection) && <NewConnectionForm />}
			{showSettingsPanel && <SettingsPanel />}
			{showErrorLogsPanel && <ErrorLogsPanel />}
			{omniStatus !== "disabled" && showAiAssistant && <AiAssistant />}
			{omniStatus !== "disabled" && !showAiAssistant && (
				<button
					type="button"
					className="voice-launcher"
					aria-label="Show AI Assistant"
					onClick={() => setShowAiAssistant(true)}
				>
					<AssistantIcon fontSize="small" />
				</button>
			)}
		</>
	);
}

export function App() {
	return (
		<AppProvider>
			<UISettingsInit />
			<WorkspaceNavigationSync />
			<MuiThemeShell>
					<div className="app-shell" data-testid="app-shell">
						<ConfigConflictBanner />
						<Sidebar
							themeToggle={<ThemeToggle />}
							terminalThemeToggle={<TerminalThemeToggle />}
						/>
						<MainPanel />
					<ErrorBanner />
					<ConfirmDialog />
					<PanelVisibility />
				</div>
			</MuiThemeShell>
		</AppProvider>
	);
}

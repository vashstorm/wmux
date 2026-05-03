import "./styles/global.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/fonts.css";

import { useEffect } from "react";
import { AppProvider, useAppState } from "./state/store.js";
import { getConfig } from "./api/client.js";
import { applyUIFontSize } from "./ui/fontSize.js";
import { MainPanel } from "./components/MainPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { NewConnectionForm } from "./components/NewConnectionForm.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ConfigConflictBanner } from "./components/ConfigConflictBanner.js";

function UISettingsInit() {
	const { setUISettings } = useAppState();

	useEffect(() => {
		void getConfig().then((config) => {
			const theme = config.ui.theme || "dark";
			const windowTheme = config.ui.windowTheme || theme;
			const fontSize = config.ui.fontSize || 16;
			const terminalFontSize = config.ui.terminalFontSize || 14;
			const terminalFontWeight = config.ui.terminalFontWeight || "normal";

			document.documentElement.dataset.theme = theme;
			applyUIFontSize(fontSize);
			setUISettings({ theme, windowTheme, fontSize, terminalFontSize, terminalFontWeight });
		}).catch(() => undefined);
	}, [setUISettings]);

	return null;
}

export function App() {
	return (
		<AppProvider>
			<UISettingsInit />
			<div className="app-shell" data-testid="app-shell">
				<ConfigConflictBanner />
				<Sidebar />
				<MainPanel />
				<ErrorBanner />
				<ConfirmDialog />
				<NewConnectionForm />
				<SettingsPanel />
			</div>
		</AppProvider>
	);
}

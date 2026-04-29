import "./styles/global.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/fonts.css";

import { useEffect } from "react";
import { AppProvider } from "./state/store.js";
import { getConfig } from "./api/client.js";
import { MainPanel } from "./components/MainPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { NewConnectionForm } from "./components/NewConnectionForm.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ConfigConflictBanner } from "./components/ConfigConflictBanner.js";

function ThemeInit() {
	useEffect(() => {
		void getConfig().then((config) => {
			document.documentElement.dataset.theme = config.ui.theme;
		}).catch(() => {
			// silently ignore — theme will fall back to default dark
		});
	}, []);
	return null;
}

export function App() {
	return (
		<AppProvider>
			<ThemeInit />
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

import "./styles/global.css";
import "./styles/layout.css";
import "./styles/components.css";

import { AppProvider } from "./state/store.js";
import { MainPanel } from "./components/MainPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { NewConnectionForm } from "./components/NewConnectionForm.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ConfigConflictBanner } from "./components/ConfigConflictBanner.js";

export function App() {
	return (
		<AppProvider>
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

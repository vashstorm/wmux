import { useAppState } from "../state/store.js";
import { WindowTabs } from "./WindowTabs.js";
import { PaneCanvas } from "./PaneCanvas.js";
import { listPanes } from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";

export function MainPanel() {
	const {
		selectedPane,
		windows,
		setSelectedPane,
		setPanes,
		setError,
	} = useAppState();

	const hasSelectedPane = selectedPane !== null;

	const sessionKey = selectedPane
		? `${selectedPane.connectionId}:${selectedPane.session}`
		: null;
	const sessionWindowState = sessionKey ? windows[sessionKey] : null;
	const windowSummaries = sessionWindowState?.windows ?? [];

	const currentWindowId = selectedPane?.window ?? null;
	const currentPanes = currentWindowId
		? (sessionWindowState?.loadedPanes[currentWindowId] ?? [])
		: [];

	const handleSelectWindow = async (windowId: string, activePaneId: string) => {
		if (!selectedPane) return;

		const loadedPanesForWindow = sessionWindowState?.loadedPanes[windowId];

		if (!loadedPanesForWindow || loadedPanesForWindow.length === 0) {
			try {
				const panesResponse = await listPanes(
					selectedPane.connectionId,
					selectedPane.session,
					windowId
				);
				const panes = panesResponse.data ?? [];
				setPanes(selectedPane.connectionId, selectedPane.session, windowId, panes);

				const activePane = panes.find((p) => p.Active) ?? panes[0];
				setSelectedPane({
					connectionId: selectedPane.connectionId,
					session: selectedPane.session,
					window: windowId,
					pane: activePane?.ID ?? activePaneId,
				});
			} catch (err) {
				if (err instanceof Error && "code" in err) {
					const apiErr = err as { code: string; message: string };
					setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
				} else {
					setError({ code: "unknown_error", message: err instanceof Error ? err.message : "Failed to load panes" });
				}
				// Still update the window selection with the provided pane ID as fallback
				setSelectedPane({
					connectionId: selectedPane.connectionId,
					session: selectedPane.session,
					window: windowId,
					pane: activePaneId,
				});
			}
		} else {
			setSelectedPane({
				connectionId: selectedPane.connectionId,
				session: selectedPane.session,
				window: windowId,
				pane: activePaneId,
			});
		}
	};

	const handleSelectPane = (paneId: string) => {
		if (!selectedPane) return;
		if (selectedPane.pane === paneId) return;

		setSelectedPane({
			connectionId: selectedPane.connectionId,
			session: selectedPane.session,
			window: selectedPane.window,
			pane: paneId,
		});
	};

	const buildTitle = () => {
		if (!hasSelectedPane || !selectedPane) return "Wmux";

		const sessionName = selectedPane.session;
		const windowSummary = windowSummaries.find((w) => w.id === selectedPane.window);
		const windowName = windowSummary?.name ?? selectedPane.window ?? "-";
		const paneData = currentPanes.find((p) => p.id === selectedPane.pane);
		const paneTitle = paneData?.title ?? selectedPane.pane ?? "-";

		return `${sessionName} / ${windowName} / ${paneTitle}`;
	};

	return (
		<div className="main-panel">
			<header className="main-header">
				<h1 className="main-header-title" data-testid="main-title">
					{buildTitle()}
				</h1>
			</header>

			<main className="main-content">
				{hasSelectedPane ? (
					<div className="main-workspace">
						<WindowTabs
							windows={windowSummaries}
							selectedWindowId={currentWindowId}
							onSelectWindow={handleSelectWindow}
						/>
						<PaneCanvas
							panes={currentPanes}
							selectedPaneId={selectedPane.pane ?? null}
							onSelectPane={handleSelectPane}
							selectedPane={selectedPane}
						/>
					</div>
				) : (
					<div className="empty-state" data-testid="empty-state">
						<div className="empty-state-icon" aria-hidden="true">
							<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								xmlns="http://www.w3.org/2000/svg"
							>
								<rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
								<path d="M6 8H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
								<path d="M6 12H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
								<path d="M6 16H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
							</svg>
						</div>
						<p className="empty-state-title">Select a session</p>
						<p className="empty-state-description">
							Click a session card in the sidebar to open the terminal
						</p>
					</div>
				)}
			</main>
		</div>
	);
}

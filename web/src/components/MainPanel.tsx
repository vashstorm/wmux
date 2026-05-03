import { useCallback, useEffect } from "react";
import { useAppState } from "../state/store.js";
import { WindowTabs } from "./WindowTabs.js";
import { PaneCanvas } from "./PaneCanvas.js";
import { listPanes, listWindows } from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";

const ACTIVE_WINDOW_SYNC_INTERVAL_MS = 1000;

interface SelectWindowOptions {
	forcePanes?: boolean;
}

export function MainPanel() {
	const {
		selectedPane,
		windows,
		setSelectedPane,
		setPanes,
		setWindows,
		setError,
		uiSettings,
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

	const handleSelectWindow = useCallback(async (
		windowId: string,
		activePaneId: string,
		options: SelectWindowOptions = {},
	) => {
		if (!selectedPane) return;

		const loadedPanesForWindow = sessionWindowState?.loadedPanes[windowId];

		if (options.forcePanes || !loadedPanesForWindow || loadedPanesForWindow.length === 0) {
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
				// 加载失败时仍使用传入的 pane ID 更新窗口选择。
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
	}, [selectedPane, sessionWindowState, setError, setPanes, setSelectedPane]);

	useEffect(() => {
		if (!selectedPane) return;

		let cancelled = false;
		let inFlight = false;

		const syncActiveWindow = async () => {
			if (cancelled || inFlight) return;

			inFlight = true;
			try {
				const windowsResponse = await listWindows(
					selectedPane.connectionId,
					selectedPane.session,
				);
				if (cancelled) return;

				const nextWindows = windowsResponse.data ?? [];
				const activeWindow = nextWindows.find((window) => window.Active);
				setWindows(selectedPane.connectionId, selectedPane.session, nextWindows);

				if (!activeWindow) return;

				if (activeWindow.ID !== selectedPane.window) {
					await handleSelectWindow(activeWindow.ID, activeWindow.ActivePaneID, {
						forcePanes: true,
					});
					return;
				}

				const panesResponse = await listPanes(
					selectedPane.connectionId,
					selectedPane.session,
					activeWindow.ID,
				);
				if (cancelled) return;

				const nextPanes = panesResponse.data ?? [];
				setPanes(selectedPane.connectionId, selectedPane.session, activeWindow.ID, nextPanes);

				const activePane = nextPanes.find((pane) => pane.Active);
				if (activePane && activePane.ID !== selectedPane.pane) {
					setSelectedPane({
						connectionId: selectedPane.connectionId,
						session: selectedPane.session,
						window: activeWindow.ID,
						pane: activePane.ID,
					});
				}
			} catch {
				// 保持终端输入顺滑；显式 API 操作仍会显示错误。
			} finally {
				inFlight = false;
			}
		};

		const intervalId = window.setInterval(() => {
			void syncActiveWindow();
		}, ACTIVE_WINDOW_SYNC_INTERVAL_MS);

		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	}, [handleSelectWindow, selectedPane, setPanes, setSelectedPane, setWindows]);

	useEffect(() => {
		if (!selectedPane || !selectedPane.window) return;

		let cancelled = false;
		const loadInitialPanes = async () => {
			try {
				const panesResponse = await listPanes(
					selectedPane.connectionId,
					selectedPane.session,
					selectedPane.window ?? "",
				);
				if (cancelled) return;
				const panes = panesResponse.data ?? [];
				setPanes(selectedPane.connectionId, selectedPane.session, selectedPane.window ?? "", panes);
			} catch {
				// 周期同步会继续尝试刷新。
			}
		};

		void loadInitialPanes();

		return () => {
			cancelled = true;
		};
	}, [selectedPane?.connectionId, selectedPane?.session, selectedPane?.window, setPanes]);

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

			<main className={`main-content${hasSelectedPane ? " has-workspace" : " is-empty"}`}>
				{hasSelectedPane ? (
					<div className="main-workspace" data-theme={uiSettings.windowTheme || uiSettings.theme}>
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
							windowTheme={uiSettings.windowTheme}
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

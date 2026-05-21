import { useCallback, useEffect } from "react";
import { Box, Typography } from "@mui/material";
import { useAppState } from "../state/store.js";
import { WindowTabs } from "./WindowTabs.js";
import { PaneCanvas } from "./PaneCanvas.js";
import { AiEventDetail } from "./AiEventDetail.js";
import { listPanes, listWindows } from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";

const ACTIVE_WINDOW_SYNC_INTERVAL_MS = 1000;

interface SelectWindowOptions {
	forcePanes?: boolean;
}

interface TitleSegment {
	key: "status" | "summary";
	value: string;
}

export function MainPanel() {
	const {
		selectedPane,
		selectedAiEvent,
		setSelectedAiEvent,
		sessions,
		windows,
		setSelectedPane,
		setPanes,
		setWindows,
		setError,
		uiSettings,
	} = useAppState();

	const hasSelectedPane = selectedPane !== null;

	const sessionKey = selectedPane
		? `${selectedPane.targetName}:${selectedPane.session}`
		: null;
	const sessionWindowState = sessionKey ? windows[sessionKey] : null;
	const windowSummaries = sessionWindowState?.windows ?? [];
	const selectedSession = selectedPane
		? (sessions[selectedPane.targetName] ?? []).find((session) => session.name === selectedPane.session)
		: null;

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
		const optimisticPaneId = loadedPanesForWindow?.find((pane) => pane.active)?.id
			?? loadedPanesForWindow?.[0]?.id
			?? activePaneId;

		setSelectedPane({
			targetName: selectedPane.targetName,
			session: selectedPane.session,
			window: windowId,
			pane: optimisticPaneId,
		});

		if (options.forcePanes || !loadedPanesForWindow || loadedPanesForWindow.length === 0) {
			try {
				const panesResponse = await listPanes(
					selectedPane.targetName,
					selectedPane.session,
					windowId
				);
				const panes = panesResponse.data ?? [];
				setPanes(selectedPane.targetName, selectedPane.session, windowId, panes);

				const activePane = panes.find((p) => p.Active) ?? panes[0];
				setSelectedPane({
					targetName: selectedPane.targetName,
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
			}
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
					selectedPane.targetName,
					selectedPane.session,
				);
				if (cancelled) return;

				const nextWindows = windowsResponse.data ?? [];
				setWindows(selectedPane.targetName, selectedPane.session, nextWindows);

				if (!selectedPane.window) return;
				if (!nextWindows.some((window) => window.ID === selectedPane.window)) {
					return;
				}

				const panesResponse = await listPanes(
					selectedPane.targetName,
					selectedPane.session,
					selectedPane.window,
				);
				if (cancelled) return;

				const nextPanes = panesResponse.data ?? [];
				setPanes(selectedPane.targetName, selectedPane.session, selectedPane.window, nextPanes);
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
	}, [selectedPane, setPanes, setWindows]);

	useEffect(() => {
		if (!selectedPane || !selectedPane.window) return;

		let cancelled = false;
		const loadInitialPanes = async () => {
			try {
				const panesResponse = await listPanes(
					selectedPane.targetName,
					selectedPane.session,
					selectedPane.window ?? "",
				);
				if (cancelled) return;
				const panes = panesResponse.data ?? [];
				setPanes(selectedPane.targetName, selectedPane.session, selectedPane.window ?? "", panes);
			} catch {
				// 周期同步会继续尝试刷新。
			}
		};

		void loadInitialPanes();

		return () => {
			cancelled = true;
		};
	}, [selectedPane?.targetName, selectedPane?.session, selectedPane?.window, setPanes]);

	const handleSelectPane = (paneId: string) => {
		if (!selectedPane) return;
		if (selectedPane.pane === paneId) return;

		setSelectedPane({
			targetName: selectedPane.targetName,
			session: selectedPane.session,
			window: selectedPane.window,
			pane: paneId,
		});
	};

	const buildTitleSegments = (): TitleSegment[] => {
		if (!hasSelectedPane || !selectedPane) {
			return [];
		}

		const windowSummary = windowSummaries.find((w) => w.id === selectedPane.window);
		const paneData = currentPanes.find((p) => p.id === selectedPane.pane);
		const status = paneData?.intelligenceStatus
			?? windowSummary?.intelligenceStatus
			?? selectedSession?.intelligenceStatus;
		const summary = windowSummary?.intelligenceSummary
			?? paneData?.intelligenceSummary
			?? paneData?.title
			?? windowSummary?.activePaneTitle
			?? selectedSession?.intelligenceSummary;

		return [
			...(status && status !== "none" ? [{ key: "status" as const, value: status }] : []),
			{ key: "summary", value: summary },
		].filter((segment): segment is TitleSegment => Boolean(segment.value && segment.value.trim()));
	};

	const titleSegments = buildTitleSegments();

	return (
		<div className="main-panel">
			<header className="main-header">
				<Box component="h1" className="main-header-title" data-testid="main-title" sx={{
					fontFamily: "var(--font-display)",
					fontSize: "var(--font-size-xl)",
					fontWeight: 700,
					color: "text.primary",
					letterSpacing: "0",
					display: "flex",
					gap: 1.5,
					alignItems: "center",
				}}>
					{titleSegments.length > 0 ? (
						titleSegments.map((segment) => (
							<Box
								key={segment.key}
								component="span"
								className={`main-title-segment is-${segment.key}`}
								data-testid={`main-title-${segment.key}`}
								title={segment.value}
								sx={{
									color: segment.key === "summary" ? "text.disabled" : "text.secondary",
									fontWeight: 500,
									...(segment.key === "summary" ? {
										opacity: 0.7,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									} : {}),
								}}
							>
								<Typography
									component="span"
									className="main-title-segment-value"
									sx={{ fontSize: "inherit", fontWeight: "inherit", color: "inherit" }}
								>
									{segment.value}
								</Typography>
							</Box>
						))
					) : (
						<Typography
							component="span"
							className="main-title-fallback"
							sx={{ color: "text.secondary" }}
						>
							Wmux
						</Typography>
					)}
				</Box>
			</header>

			<main className={`main-content${hasSelectedPane ? " has-workspace" : " is-empty"}`}>
				{selectedAiEvent ? (
					<AiEventDetail event={selectedAiEvent} onClose={() => setSelectedAiEvent(null)} />
				) : hasSelectedPane ? (
					<div className="main-workspace">
						<WindowTabs
							windows={windowSummaries}
							loadedPanesByWindow={sessionWindowState?.loadedPanes}
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
					<Box className="empty-state" data-testid="empty-state" sx={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						gap: 2.5,
						padding: 5,
						minHeight: 280,
					}}>
						<Box className="empty-state-icon" aria-hidden="true" sx={{
							width: 64,
							height: 64,
							borderRadius: "50%",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							bgcolor: "var(--color-accent-subtle)",
							color: "primary.main",
							mb: 0.5,
						}}>
							<svg
								width="28"
								height="28"
								viewBox="0 0 24 24"
								fill="none"
								xmlns="http://www.w3.org/2000/svg"
							>
								<rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
								<path d="M6 8H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
								<path d="M6 12H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
								<path d="M6 16H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
							</svg>
						</Box>
						<Typography className="empty-state-title" sx={{
							fontSize: "var(--font-size-xl)",
							fontWeight: 700,
							color: "text.primary",
							letterSpacing: "0",
						}}>
							Select a session
						</Typography>
						<Typography className="empty-state-description" sx={{
							fontSize: "var(--font-size-sm)",
							color: "text.secondary",
							textAlign: "center",
							maxWidth: 280,
							lineHeight: 1.6,
						}}>
							Choose a session from the sidebar to start working in the terminal
						</Typography>
					</Box>
				)}
			</main>
		</div>
	);
}

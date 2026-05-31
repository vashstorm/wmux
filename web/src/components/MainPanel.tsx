import { useCallback, useEffect } from "react";
import { Box, Typography } from "@mui/material";
import { useAppState } from "../state/store.js";
import { WindowTabs } from "./WindowTabs.js";
import { PaneCanvas } from "./PaneCanvas.js";
import { AiEventDetail } from "./AiEventDetail.js";
import { AiLogDetail } from "./AiLogDetail.js";
import { ProjectDashboard } from "./ProjectDashboard.js";
import { listPanes, listWindows, type AiUsageEvent } from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";
import { isProjectAiHtmlEvent, parseAiUsageResponse } from "./aiUsagePresentation.js";

const ACTIVE_WINDOW_SYNC_INTERVAL_MS = 1000;

interface SelectWindowOptions {
	forcePanes?: boolean;
}

interface TitleSegment {
	key: "app" | "status" | "summary";
	value: string;
}

interface EventIntelligence {
	app: string;
	status: string;
	summary: string;
}

function getAiEventDetails(event: AiUsageEvent): EventIntelligence {
	const usageResponse = parseAiUsageResponse(event.responseJson);
	if (isProjectAiHtmlEvent(event, usageResponse)) {
		return {
			app: "Project HTML",
			status: event.status,
			summary: usageResponse.summary ?? "Project AI HTML generated",
		};
	}

	const res: EventIntelligence = { app: "", status: "", summary: "" };
	if (!event.responseJson) return res;
	try {
		const parsed = JSON.parse(event.responseJson);
		// Try content from OpenAI format or direct content
		const contentStr = parsed.choices?.[0]?.message?.content ?? parsed.content ?? null;
		
		if (contentStr) {
			if (typeof contentStr === "string") {
				try {
					const parsedContent = JSON.parse(contentStr);
					res.app = parsedContent.application ?? parsedContent.app ?? "";
					res.status = parsedContent.status ?? "";
					res.summary = parsedContent.summary ?? "";
				} catch {
					// Not JSON string content, treat it as summary
					res.summary = contentStr;
				}
			} else if (typeof contentStr === "object") {
				const contentObj = contentStr as Record<string, unknown>;
				res.app = String(contentObj.application ?? contentObj.app ?? "");
				res.status = String(contentObj.status ?? "");
				res.summary = String(contentObj.summary ?? "");
			}
		} else {
			// Try top-level application / status / summary if it was direct
			res.app = parsed.application ?? parsed.app ?? "";
			res.status = parsed.status ?? "";
			res.summary = parsed.summary ?? "";
		}
	} catch {
		// Ignore parsing errors
	}
	return res;
}

export function MainPanel() {
	const {
		selectedPane,
		selectedAiEvent,
		selectedAiLog = null,
		selectedProject,
		setSelectedAiEvent,
		setSelectedAiLog = () => {},
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
		const intervalIdRef = { current: 0 };

		const syncActiveWindow = async () => {
			if (document.visibilityState === "hidden") return;
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

		const startInterval = () => {
			if (intervalIdRef.current !== 0) {
				window.clearInterval(intervalIdRef.current);
			}
			const id = window.setInterval(() => {
				void syncActiveWindow();
			}, ACTIVE_WINDOW_SYNC_INTERVAL_MS);
			intervalIdRef.current = id;
		};

		const stopInterval = () => {
			if (intervalIdRef.current !== 0) {
				window.clearInterval(intervalIdRef.current);
				intervalIdRef.current = 0;
			}
		};

		const handleVisibilityChange = () => {
			if (document.visibilityState === "hidden") {
				stopInterval();
			} else if (document.visibilityState === "visible") {
				void syncActiveWindow();
				startInterval();
			}
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);

		startInterval();

		return () => {
			cancelled = true;
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			stopInterval();
		};
	}, [selectedPane, setPanes, setWindows]);

	useEffect(() => {
		if (!selectedPane || !selectedPane.window) return;

		let cancelled = false;
		const loadInitialPanes = async () => {
			if (document.visibilityState === "hidden") return;
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
		if (selectedAiEvent) {
			const details = getAiEventDetails(selectedAiEvent);
			const segments: TitleSegment[] = [];
			if (details.app) {
				segments.push({ key: "app", value: details.app });
			}
			if (details.status) {
				segments.push({ key: "status", value: details.status });
			}
			if (details.summary) {
				segments.push({ key: "summary", value: details.summary });
			}
			return segments;
		}

		if (selectedAiLog) {
			const segments: TitleSegment[] = [];
			segments.push({ key: "app", value: selectedAiLog.eventKind });
			segments.push({ key: "status", value: selectedAiLog.status });
			if (selectedAiLog.toolName) {
				segments.push({ key: "summary", value: `Tool: ${selectedAiLog.toolName}` });
			} else {
				segments.push({ key: "summary", value: selectedAiLog.model });
			}
			return segments;
		}

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
			<header className="main-header" style={{ boxShadow: "var(--shadow-header-bottom)" }}>
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
									color: segment.key === "summary" ? "text.primary" : "text.secondary",
									fontWeight: segment.key === "summary" ? 500 : 500,
									fontSize: "var(--font-size-base)",
									letterSpacing: "-0.01em",
									...(segment.key === "summary" ? {
										opacity: 0.95,
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
					) : null}
				</Box>
			</header>

			<main className={`main-content${hasSelectedPane || selectedProject || selectedAiEvent || selectedAiLog ? " has-workspace" : " is-empty"}`}>
				{selectedAiEvent ? (
					<AiEventDetail event={selectedAiEvent} onClose={() => setSelectedAiEvent(null)} />
				) : selectedAiLog ? (
					<AiLogDetail log={selectedAiLog} onClose={() => setSelectedAiLog(null)} />
				) : selectedProject ? (
					<ProjectDashboard />
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
						animation: "fadeSlideUp 400ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
					}}>
						<Box className="empty-state-icon" aria-hidden="true" sx={{
							width: 80,
							height: 80,
							borderRadius: "50%",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							bgcolor: "var(--color-accent-subtle)",
							color: "primary.main",
							mb: 0.5,
							boxShadow: "var(--glow-accent), var(--color-accent-glow)",
							background: (theme) =>
								theme.palette.mode === "dark"
									? "radial-gradient(circle at 30% 30%, rgba(107,130,245,0.2) 0%, rgba(107,130,245,0.08) 100%)"
									: "radial-gradient(circle at 30% 30%, rgba(79,107,237,0.12) 0%, rgba(79,107,237,0.04) 100%)",
							border: "1px solid",
							borderColor: "var(--color-accent-subtle)",
						}}>
							<svg
								width="40"
								height="40"
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
							background: "var(--color-accent-gradient)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
							backgroundClip: "text",
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

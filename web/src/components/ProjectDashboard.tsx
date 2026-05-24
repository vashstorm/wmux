import { useState, useCallback } from "react";
import { Box, Typography, Button, Chip, CircularProgress, Paper, Divider, Stack } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SyncIcon from "@mui/icons-material/Sync";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { useAppState } from "../state/store.js";
import { launchProject, syncProjectFromTmux, generateProjectAiHtml, getProject, listWindows, listPanes } from "../api/client.js";
import { SafeHtml } from "./SafeHtml.js";
import { ApiError } from "../api/errors.js";

const DETAIL_FONT_SIZE = {
	title: "var(--font-size-lg)",
	section: "var(--font-size-xs)",
	label: "var(--font-size-xs)",
	body: "var(--font-size-sm)",
	value: "var(--font-size-sm)",
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<Box className="project-detail-row" sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 2, py: 0.5 }}>
			<Typography variant="caption" sx={{ color: "text.secondary", fontSize: DETAIL_FONT_SIZE.label, flexShrink: 0, minWidth: 100 }}>
				{label}
			</Typography>
			<Typography
				variant="body2"
				sx={{
					fontSize: DETAIL_FONT_SIZE.value,
					fontWeight: "var(--font-weight-medium)",
					textAlign: "right",
					wordBreak: "break-all",
				}}
			>
				{value || "—"}
			</Typography>
		</Box>
	);
}

function statusColor(status: string): "success" | "error" | "warning" | "default" {
	switch (status) {
	case "running":
	case "active":
		return "success";
	case "error":
	case "failed":
		return "error";
	case "pending":
	case "generating":
		return "warning";
	default:
		return "default";
	}
}

function formatTimestamp(iso: string | null): string {
	if (!iso) return "—";
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}

function tryParseJson<T>(jsonString: string | null): T | null {
	if (!jsonString) return null;
	let cleaned = jsonString;
	if (cleaned.startsWith("\"") && cleaned.endsWith("\"")) {
		try {
			cleaned = JSON.parse(cleaned);
		} catch {
			// double-encoded JSON, skip
		}
	}
	if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
		try {
			return JSON.parse(cleaned) as T;
		} catch {
			return null;
		}
	}
	return null;
}

export function ProjectDashboard() {
	const {
		selectedProject,
		setSelectedProject,
		selectedTargetName,
		setSelectedPane,
		setWindows,
		setPanes,
	} = useAppState();
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const refreshProject = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const updated = await getProject(selectedProject.id);
			setSelectedProject(updated);
		} catch {
			// stale reads are acceptable
		}
	}, [selectedProject, setSelectedProject]);

	const handleLaunch = useCallback(async () => {
		if (!selectedProject) return;
		setActionLoading("launch");
		setActionError(null);
		try {
			await launchProject(selectedProject.id);
			await refreshProject();

			const targetName = selectedTargetName ?? "local";
			const sessionName = selectedProject.sessionName;

			if (sessionName) {
				try {
					const windowsResponse = await listWindows(targetName, sessionName);
					const windows = windowsResponse?.data ?? [];

					if (windows.length === 0) {
						setSelectedPane({ targetName, session: sessionName });
						setActionLoading(null);
						setTimeout(() => {
							setSelectedProject(null);
						}, 50);
						return;
					}

					const initialWindow = windows[0];
					if (initialWindow) {
						const initialWindowID = initialWindow.ID;
						const panesResponse = await listPanes(targetName, sessionName, initialWindowID);
						const panes = panesResponse?.data ?? [];

						setWindows(targetName, sessionName, windows);
						setPanes(targetName, sessionName, initialWindowID, panes);

						const initialPane = panes[0];
						setSelectedPane({
							targetName,
							session: sessionName,
							window: initialWindowID,
							pane: initialPane?.ID,
						});
					} else {
						setSelectedPane({ targetName, session: sessionName });
					}
					setActionLoading(null);
					setTimeout(() => {
						setSelectedProject(null);
					}, 50);
				} catch {
					setSelectedPane({ targetName, session: sessionName });
					setActionLoading(null);
					setTimeout(() => {
						setSelectedProject(null);
					}, 50);
				}
			}
		} catch (err) {
			setActionError(err instanceof ApiError ? err.message : "Failed to launch project");
		} finally {
			setActionLoading(null);
		}
	}, [selectedProject, refreshProject, selectedTargetName, setSelectedPane, setSelectedProject, setWindows, setPanes]);

	const handleSync = useCallback(async () => {
		if (!selectedProject) return;
		setActionLoading("sync");
		setActionError(null);
		try {
			await syncProjectFromTmux(selectedProject.id);
			await refreshProject();
		} catch (err) {
			setActionError(err instanceof ApiError ? err.message : "Failed to sync project");
		} finally {
			setActionLoading(null);
		}
	}, [selectedProject, refreshProject]);

	const handleAiGenerate = useCallback(async () => {
		if (!selectedProject) return;
		setActionLoading("ai-generate");
		setActionError(null);
		try {
			await generateProjectAiHtml(selectedProject.id);
			await refreshProject();
		} catch (err) {
			setActionError(err instanceof ApiError ? err.message : "Failed to generate AI HTML");
		} finally {
			setActionLoading(null);
		}
	}, [selectedProject, refreshProject]);

	if (!selectedProject) {
		return null;
	}

	const layoutData = tryParseJson(selectedProject.layoutJson);
	const detailsData = tryParseJson(selectedProject.detailsJson);
	const progressData = tryParseJson(selectedProject.progressJson);

	const layoutSummary = layoutData && typeof layoutData === "object" && "windows" in layoutData
		? `${(layoutData as { windows?: unknown[] }).windows?.length ?? 0} windows`
		: null;

	const detailsSummary = detailsData && typeof detailsData === "object"
		? Object.keys(detailsData).length > 0
			? `${Object.keys(detailsData).length} fields`
			: null
		: null;

	const progressValue = progressData && typeof progressData === "object" && "percent" in progressData
		? (progressData as { percent?: number }).percent
		: null;

	return (
		<Box
			data-testid="project-dashboard"
			className="project-dashboard"
			sx={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
			}}
		>
			<Box className="project-dashboard-header" sx={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				px: "var(--spacing-lg)",
				minHeight: "var(--app-shell-header-height, 42px)",
				borderBottom: "1px solid",
				borderColor: "divider",
			}}>
				<Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
					<Typography
						data-testid="project-dashboard-title"
						variant="subtitle2"
						sx={{
							fontSize: DETAIL_FONT_SIZE.title,
							fontWeight: "var(--font-weight-bold)",
							fontFamily: "var(--font-display)",
						}}
					>
						{selectedProject.name}
					</Typography>
					<Chip
						label={selectedProject.status}
						size="small"
						color={statusColor(selectedProject.status)}
						variant="outlined"
						sx={{ fontSize: DETAIL_FONT_SIZE.label, height: 24 }}
					/>
				</Box>
			</Box>

			<Box
				className="project-dashboard-body"
				sx={{
					flex: 1,
					display: "flex",
					flexDirection: { xs: "column", md: "row" },
					gap: 3,
					px: "var(--spacing-lg)",
					py: "var(--spacing-md)",
					overflow: { xs: "auto", md: "hidden" },
				}}
			>
				{/* Main Content Area (Left Column): AI Generated Content */}
				<Box
					sx={{
						flex: 1,
						minWidth: 0,
						height: { xs: "auto", md: "100%" },
						display: "flex",
						flexDirection: "column",
					}}
				>
					<Typography
						variant="caption"
						sx={{
							color: "text.disabled",
							fontSize: DETAIL_FONT_SIZE.section,
							textTransform: "uppercase",
							letterSpacing: "0",
							fontWeight: "var(--font-weight-semibold)",
							mb: 1,
						}}
					>
						AI Generated Content
					</Typography>

					{selectedProject.aiStatus === "generating" ? (
						<Paper
							variant="outlined"
							className="project-dashboard-card"
							sx={{
								flex: 1,
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								justifyContent: "center",
								p: 4,
								bgcolor: "background.default",
								borderColor: "divider",
								borderRadius: "var(--radius-lg)",
								minHeight: 280,
							}}
						>
							<CircularProgress size={24} sx={{ mb: 1.5 }} />
							<Typography variant="body2" color="text.secondary" sx={{ fontSize: DETAIL_FONT_SIZE.body }}>
								Generating AI content...
							</Typography>
						</Paper>
					) : selectedProject.aiStatus === "error" ? (
						<Paper
							variant="outlined"
							className="project-dashboard-card"
							sx={{
								flex: 1,
								p: 3,
								bgcolor: "error.main",
								color: "error.contrastText",
								borderColor: "error.dark",
								borderRadius: "var(--radius-lg)",
								minHeight: 280,
							}}
						>
							<Typography variant="body2" sx={{ fontSize: DETAIL_FONT_SIZE.body, fontWeight: "bold", mb: 1 }}>
								AI Generation Error
							</Typography>
							<Typography variant="body2" sx={{ fontSize: DETAIL_FONT_SIZE.body }}>
								{selectedProject.aiError || "AI generation failed"}
							</Typography>
						</Paper>
					) : !selectedProject.aiHtml ? (
						<Paper
							variant="outlined"
							className="project-dashboard-card"
							sx={{
								flex: 1,
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								justifyContent: "center",
								p: 4,
								bgcolor: "background.default",
								borderColor: "divider",
								borderRadius: "var(--radius-lg)",
								minHeight: 280,
							}}
						>
							<Typography variant="body2" color="text.secondary" sx={{ fontSize: DETAIL_FONT_SIZE.body, textAlign: "center", mb: 2 }}>
								No AI-generated content yet. Click &ldquo;Generate AI HTML&rdquo; to start.
							</Typography>
							<Button
								size="small"
								variant="outlined"
								className="project-dashboard-btn project-dashboard-btn-secondary"
								startIcon={actionLoading === "ai-generate" ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon fontSize="small" />}
								disabled={actionLoading !== null}
								onClick={handleAiGenerate}
							>
								Generate AI HTML
							</Button>
						</Paper>
					) : (
						<Paper
							data-testid="project-ai-html"
							className="project-dashboard-card project-dashboard-ai-frame"
							variant="outlined"
							sx={{
								flex: 1,
								p: 3,
								bgcolor: "background.default",
								borderColor: "divider",
								overflow: "auto",
								borderRadius: "var(--radius-lg)",
							}}
						>
							<SafeHtml html={selectedProject.aiHtml} />
						</Paper>
					)}
				</Box>

				{/* Sidebar (Right Column): Actions & Project Metadata */}
				<Box
					sx={{
						width: { xs: "100%", md: 320 },
						flexShrink: 0,
						height: { xs: "auto", md: "100%" },
						overflowY: { xs: "visible", md: "auto" },
						display: "flex",
						flexDirection: "column",
						gap: 2.5,
						borderLeft: { xs: "none", md: "1px solid" },
						borderColor: { md: "divider" },
						pl: { xs: 0, md: 3 },
						"&::-webkit-scrollbar": {
							display: "none",
						},
						msOverflowStyle: "none",
						scrollbarWidth: "none",
					}}
				>
					{/* Actions Block */}
					<Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
						<Typography
							variant="caption"
							sx={{
								color: "text.disabled",
								fontSize: DETAIL_FONT_SIZE.section,
								textTransform: "uppercase",
								letterSpacing: "0",
								fontWeight: "var(--font-weight-semibold)",
							}}
						>
							Actions
						</Typography>
						<Stack
							className="project-dashboard-actions"
							direction={{ xs: "row", md: "column" }}
							spacing={1.5}
							sx={{ width: "100%" }}
						>
							<Button
								size="small"
								variant="contained"
								className="project-dashboard-btn project-dashboard-btn-primary"
								startIcon={actionLoading === "launch" ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon fontSize="small" />}
								disabled={actionLoading !== null}
								onClick={handleLaunch}
								data-testid="project-launch-button"
								sx={{ flex: { xs: 1, md: "initial" } }}
							>
								Launch
							</Button>
							<Button
								size="small"
								variant="outlined"
								className="project-dashboard-btn project-dashboard-btn-secondary"
								startIcon={actionLoading === "sync" ? <CircularProgress size={16} color="inherit" /> : <SyncIcon fontSize="small" />}
								disabled={actionLoading !== null}
								onClick={handleSync}
								data-testid="project-sync-button"
								sx={{ flex: { xs: 1, md: "initial" } }}
							>
								Sync from tmux
							</Button>
							<Button
								size="small"
								variant="outlined"
								className="project-dashboard-btn project-dashboard-btn-secondary"
								startIcon={actionLoading === "ai-generate" ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon fontSize="small" />}
								disabled={actionLoading !== null}
								onClick={handleAiGenerate}
								data-testid="project-ai-generate-button"
								sx={{ flex: { xs: 1, md: "initial" } }}
							>
								Generate AI HTML
							</Button>
						</Stack>
						{actionError && (
							<Typography color="error" variant="caption" sx={{ display: "block", mt: 0.5 }}>
								{actionError}
							</Typography>
						)}
					</Box>

					{/* Metadata Cards */}
					<Box sx={{ display: "flex", flexDirection: "column", gap: 2, pb: { xs: 2, md: 0 } }}>
						<Box>
							<Typography
								variant="caption"
								sx={{
									color: "text.disabled",
									fontSize: DETAIL_FONT_SIZE.section,
									textTransform: "uppercase",
									letterSpacing: "0",
									fontWeight: "var(--font-weight-semibold)",
								}}
							>
								Project Info
							</Typography>
							<Paper
								variant="outlined"
								className="project-dashboard-card"
								sx={{
									mt: 0.5,
									p: 1.5,
									bgcolor: "background.default",
									borderColor: "divider",
								}}
							>
								<DetailRow label="Name" value={selectedProject.name} />
								<DetailRow label="Session" value={selectedProject.sessionName} />
								<DetailRow label="Status" value={selectedProject.status} />
								<DetailRow label="Working dir" value={selectedProject.workdir} />
								<DetailRow label="Path" value={selectedProject.path} />
								{selectedProject.description && (
									<DetailRow label="Description" value={selectedProject.description} />
								)}
								<DetailRow label="Created" value={formatTimestamp(selectedProject.createdAt)} />
								<DetailRow label="Updated" value={formatTimestamp(selectedProject.updatedAt)} />
								<DetailRow label="Last synced" value={formatTimestamp(selectedProject.lastSyncedAt)} />
							</Paper>
						</Box>

						{layoutSummary && (
							<Box>
								<Typography
									variant="caption"
									sx={{
										color: "text.disabled",
										fontSize: DETAIL_FONT_SIZE.section,
										textTransform: "uppercase",
										letterSpacing: "0",
										fontWeight: "var(--font-weight-semibold)",
									}}
								>
									Layout
								</Typography>
								<Paper
									variant="outlined"
									className="project-dashboard-card"
									sx={{
										mt: 0.5,
										p: 1.5,
										bgcolor: "background.default",
										borderColor: "divider",
									}}
								>
									<DetailRow label="Summary" value={layoutSummary} />
								</Paper>
							</Box>
						)}

						{detailsSummary && (
							<Box>
								<Typography
									variant="caption"
									sx={{
										color: "text.disabled",
										fontSize: DETAIL_FONT_SIZE.section,
										textTransform: "uppercase",
										letterSpacing: "0",
										fontWeight: "var(--font-weight-semibold)",
									}}
								>
									Details
								</Typography>
								<Paper
									variant="outlined"
									className="project-dashboard-card"
									sx={{
										mt: 0.5,
										p: 1.5,
										bgcolor: "background.default",
										borderColor: "divider",
									}}
								>
									<DetailRow label="Summary" value={detailsSummary} />
								</Paper>
							</Box>
						)}

						{progressValue != null && (
							<Box>
								<Typography
									variant="caption"
									sx={{
										color: "text.disabled",
										fontSize: DETAIL_FONT_SIZE.section,
										textTransform: "uppercase",
										letterSpacing: "0",
										fontWeight: "var(--font-weight-semibold)",
									}}
								>
									Progress
								</Typography>
								<Paper
									variant="outlined"
									className="project-dashboard-card"
									sx={{
										mt: 0.5,
										p: 1.5,
										bgcolor: "background.default",
										borderColor: "divider",
									}}
								>
									<DetailRow label="Percent" value={`${progressValue}%`} />
								</Paper>
							</Box>
						)}
					</Box>
				</Box>
			</Box>
		</Box>
	);
}

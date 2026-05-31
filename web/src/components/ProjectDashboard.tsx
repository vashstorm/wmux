import { useState, useCallback } from "react";
import { Alert, Box, Typography, Button, Chip, CircularProgress, Paper, Divider, Stack } from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { useAppState } from "../state/store.js";
import { syncProjectFromTmux, generateProjectAiHtml, getProject } from "../api/client.js";
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
	case "completed":
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

function aiStatusLabel(status: string, hasHtml: boolean, isGenerating: boolean): string {
	if (isGenerating) return "generating";
	if (status.trim() && status !== "idle") return status;
	return hasHtml ? "completed" : "idle";
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

function byteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectDashboard() {
	const {
		selectedProject,
		setSelectedProject,
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
	const aiHtml = selectedProject.aiHtml ?? "";
	const aiStatus = selectedProject.aiStatus ?? "";
	const hasAiHtml = aiHtml.trim().length > 0;
	const isGeneratingAiHtml = actionLoading === "ai-generate" || aiStatus === "generating";
	const currentAiStatus = aiStatusLabel(aiStatus, hasAiHtml, isGeneratingAiHtml);
	const aiHtmlSize = hasAiHtml ? formatBytes(byteLength(aiHtml)) : null;
	const aiUpdatedAt = hasAiHtml || aiStatus === "error"
		? formatTimestamp(selectedProject.updatedAt)
		: "—";
	const aiStatusChip = (
		<Chip
			label={currentAiStatus}
			size="small"
			color={statusColor(currentAiStatus)}
			variant="outlined"
			data-testid="project-ai-status"
			sx={{ fontSize: DETAIL_FONT_SIZE.label, height: 24 }}
		/>
	);

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
					<Stack
						direction={{ xs: "column", sm: "row" }}
						sx={{
							alignItems: { xs: "flex-start", sm: "center" },
							justifyContent: "space-between",
							gap: 1,
							mb: 1,
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
							}}
						>
							AI Generated Content
						</Typography>
						<Stack
							direction="row"
							spacing={0.75}
							sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.75 }}
							data-testid="project-ai-meta"
						>
							{aiStatusChip}
							{aiHtmlSize && (
								<Chip
									label={aiHtmlSize}
									size="small"
									variant="outlined"
									sx={{ fontSize: DETAIL_FONT_SIZE.label, height: 24 }}
								/>
							)}
							<Typography variant="caption" color="text.secondary" sx={{ fontSize: DETAIL_FONT_SIZE.label }}>
								Updated {aiUpdatedAt}
							</Typography>
						</Stack>
					</Stack>

					{actionError && (
						<Alert severity="error" sx={{ mb: 1.5 }} data-testid="project-action-error">
							{actionError}
						</Alert>
					)}

					{isGeneratingAiHtml ? (
						<Paper
							variant="outlined"
							className="project-dashboard-card"
							sx={{
								flex: 1,
								display: "flex",
								flexDirection: "column",
								bgcolor: "background.default",
								borderColor: "divider",
								borderRadius: "var(--radius-lg)",
								minHeight: 280,
								overflow: "hidden",
							}}
						>
							<Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
								<Typography variant="body2" sx={{ fontSize: DETAIL_FONT_SIZE.body, fontWeight: "var(--font-weight-semibold)" }}>
									Generating HTML summary
								</Typography>
							</Box>
							<Box
								sx={{
									flex: 1,
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									justifyContent: "center",
									p: 4,
								}}
							>
								<CircularProgress size={24} sx={{ mb: 1.5 }} />
								<Typography variant="body2" color="text.secondary" sx={{ fontSize: DETAIL_FONT_SIZE.body }}>
									Generating AI content...
								</Typography>
							</Box>
						</Paper>
					) : aiStatus === "error" ? (
						<Paper
							variant="outlined"
							className="project-dashboard-card"
							sx={{
								flex: 1,
								bgcolor: "background.default",
								borderColor: "error.main",
								borderRadius: "var(--radius-lg)",
								minHeight: 280,
								overflow: "hidden",
							}}
						>
							<Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
								<Typography variant="body2" sx={{ fontSize: DETAIL_FONT_SIZE.body, fontWeight: "var(--font-weight-semibold)" }}>
									Generation failed
								</Typography>
							</Box>
							<Box sx={{ p: 2.5 }}>
								<Alert severity="error" sx={{ mb: 2 }} data-testid="project-ai-error">
									{selectedProject.aiError || "AI generation failed"}
								</Alert>
								<Button
									size="small"
									variant="outlined"
									className="project-dashboard-btn project-dashboard-btn-secondary"
									startIcon={<AutoFixHighIcon fontSize="small" />}
									disabled={actionLoading !== null}
									onClick={handleAiGenerate}
								>
									Generate AI HTML
								</Button>
							</Box>
						</Paper>
					) : !hasAiHtml ? (
						<Paper
							variant="outlined"
							className="project-dashboard-card"
							sx={{
								flex: 1,
								display: "flex",
								flexDirection: "column",
								bgcolor: "background.default",
								borderColor: "divider",
								borderRadius: "var(--radius-lg)",
								minHeight: 280,
								overflow: "hidden",
							}}
						>
							<Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
								<Typography variant="body2" sx={{ fontSize: DETAIL_FONT_SIZE.body, fontWeight: "var(--font-weight-semibold)" }}>
									No generated HTML yet
								</Typography>
							</Box>
							<Box
								sx={{
									flex: 1,
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									justifyContent: "center",
									p: 4,
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
							</Box>
						</Paper>
					) : (
						<Paper
							data-testid="project-ai-html"
							className="project-dashboard-card project-dashboard-ai-frame"
							variant="outlined"
							sx={{
								flex: 1,
								bgcolor: "background.default",
								borderColor: "divider",
								borderRadius: "var(--radius-lg)",
								overflow: "hidden",
								display: "flex",
								flexDirection: "column",
							}}
						>
							<Box
								sx={{
									px: 2,
									py: 1.25,
									borderBottom: "1px solid",
									borderColor: "divider",
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 1.5,
								}}
							>
								<Typography variant="body2" sx={{ fontSize: DETAIL_FONT_SIZE.body, fontWeight: "var(--font-weight-semibold)" }}>
									Generated HTML summary
								</Typography>
								<Typography variant="caption" color="text.secondary" sx={{ fontSize: DETAIL_FONT_SIZE.label, flexShrink: 0 }}>
									{aiHtmlSize}
								</Typography>
							</Box>
							<Box
								data-testid="project-ai-html-content"
								sx={{
									flex: 1,
									overflow: "auto",
									p: { xs: 2, md: 3 },
								}}
							>
								<SafeHtml html={aiHtml} />
							</Box>
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
					</Box>

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
							AI Output
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
							<DetailRow label="Status" value={currentAiStatus} />
							<DetailRow label="HTML size" value={aiHtmlSize ?? "—"} />
							<DetailRow label="Updated" value={aiUpdatedAt} />
						</Paper>
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

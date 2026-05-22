import { useState } from "react";
import {
	Box,
	Stack,
	Chip,
	Typography,
	TextField,
	ListItemButton,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import type { SessionInfoData } from "../../api/client.js";
import { SidebarIconButton } from "./SidebarIconButton.js";

const INTELLIGENCE_STATUS_LABELS: Record<string, string> = {
	waiting: "Waiting",
	dead_loop: "Loop",
	blocked: "Blocked",
	waiting_confirm: "Confirm",
	waiting_idle: "Idle",
	running: "Running",
};

const KNOWN_APP_BADGE_ORDER = ["claude", "codex", "opencode", "zsh"] as const;
const KNOWN_APP_BADGES = new Set<string>(KNOWN_APP_BADGE_ORDER);

function getAppBadgeEntries(appCounts: Record<string, number> | undefined): Array<[string, number]> {
	if (!appCounts) {
		return [];
	}

	return Object.entries(appCounts)
		.map(([app, count]) => [app.trim().toLowerCase(), count] as [string, number])
		.filter(([app, count]) => app.length > 0 && typeof count === "number" && count > 0)
		.sort(([left], [right]) => {
			const leftKnownIndex = KNOWN_APP_BADGE_ORDER.indexOf(left as (typeof KNOWN_APP_BADGE_ORDER)[number]);
			const rightKnownIndex = KNOWN_APP_BADGE_ORDER.indexOf(right as (typeof KNOWN_APP_BADGE_ORDER)[number]);
			if (leftKnownIndex >= 0 && rightKnownIndex >= 0) return leftKnownIndex - rightKnownIndex;
			if (leftKnownIndex >= 0) return -1;
			if (rightKnownIndex >= 0) return 1;
			return left.localeCompare(right);
		});
}

interface SessionCardProps {
	session: SessionInfoData;
	isSelected: boolean;
	onOpen: (sessionName: string) => void;
	onRename: (sessionName: string) => void;
	onKill: (sessionName: string) => void;
	onSubmitRename: (sessionName: string, newName: string) => Promise<void>;
	onBuildProject: (sessionName: string) => void;
}

export function SessionCard({
	session,
	isSelected,
	onOpen,
	onRename,
	onKill,
	onSubmitRename,
	onBuildProject,
}: SessionCardProps) {
	const sname = session.name ?? "";
	const [isRenaming, setIsRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState("");

	if (!sname) return null;

	const handleStartRename = () => {
		onRename(sname);
		setIsRenaming(true);
		setRenameValue(sname);
	};

	const handleSubmitRename = async () => {
		const newName = renameValue.trim();
		if (!newName || newName === sname) {
			setIsRenaming(false);
			setRenameValue("");
			return;
		}
		await onSubmitRename(sname, newName);
		setIsRenaming(false);
		setRenameValue("");
	};

	const handleRenameKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") handleSubmitRename();
		if (e.key === "Escape") {
			setIsRenaming(false);
			setRenameValue("");
		}
	};

	const hasAttention = session.attentionState === "attention" || session.attentionState === "explicit";
	const hasIntelligence =
		(session.intelligenceStatus && session.intelligenceStatus !== "none" && INTELLIGENCE_STATUS_LABELS[session.intelligenceStatus]) ||
		session.intelligenceError;
	const appBadgeEntries = getAppBadgeEntries(session.intelligenceAppCounts);
	const intelligenceBadgeClass = session.intelligenceError ? "error" : session.intelligenceStatus;
	const intelligenceBadgeLabel = session.intelligenceError
		? "Error"
		: session.intelligenceStatus
			? INTELLIGENCE_STATUS_LABELS[session.intelligenceStatus]
			: undefined;

	// Determine border/glow overrides from attention or intelligence state
	const isExplicit = session.attentionState === "explicit"
		&& session.intelligenceStatus !== "waiting_confirm"
		&& session.intelligenceStatus !== "blocked";
	const isAttentionSoft = session.attentionState === "attention"
		&& !isSelected
		&& session.intelligenceStatus !== "waiting_confirm"
		&& session.intelligenceStatus !== "blocked";
	const isWaitingConfirm = session.intelligenceStatus === "waiting_confirm";
	const isBlocked = session.intelligenceStatus === "blocked";

	let borderColor = isSelected
		? "var(--color-session-card-selected-border)"
		: "var(--color-session-card-border)";
	let boxShadow = isSelected ? "var(--color-session-card-selected-glow)" : "none";

	if (isExplicit) {
		borderColor = "var(--color-attention-explicit)";
		boxShadow = "0 0 0 1px var(--color-attention-explicit), var(--glow-danger)";
	} else if (isWaitingConfirm) {
		borderColor = "#b45309";
		boxShadow = "0 0 0 1px #b45309, 0 0 12px rgba(180, 83, 9, 0.25)";
	} else if (isBlocked) {
		borderColor = "#be123c";
		boxShadow = "0 0 0 1px #be123c, var(--glow-danger)";
	} else if (isAttentionSoft) {
		borderColor = "var(--color-attention)";
	}

	return (
		<Box
			className={`session-card${session.attentionState === "explicit" ? " is-attention-explicit" : ""}${session.attentionState === "attention" ? " is-attention" : ""}${session.intelligenceStatus === "waiting_confirm" ? " is-waiting-confirm" : ""}${session.intelligenceStatus === "blocked" ? " is-blocked" : ""}${isSelected ? " is-selected" : ""}`}
			data-testid={`session-card-${sname}`}
			sx={{
				width: "100%",
				borderRadius: "var(--radius-md)",
				border: "1px solid",
				borderColor,
				bgcolor: isSelected
					? "var(--color-session-card-selected)"
					: "var(--color-session-card-bg)",
				transition: "border-color var(--transition-base), background-color var(--transition-base), box-shadow var(--transition-base), transform var(--transition-base)",
				boxShadow,
				position: "relative",
				overflow: "hidden",
				"&:hover": {
					transform: "translateY(-1px)",
					boxShadow: isSelected
						? "var(--color-session-card-selected-glow)"
						: "var(--shadow-md)",
				},
			}}
		>
			{isRenaming ? (
				<Box
					className="session-card-rename"
					sx={{
						p: "var(--spacing-sm)",
						animation: "fadeIn 150ms ease",
					}}
				>
					<TextField
						fullWidth
						size="small"
						value={renameValue}
						onChange={(e) => setRenameValue(e.target.value)}
						onBlur={handleSubmitRename}
						onKeyDown={handleRenameKeyDown}
						autoFocus
						className="session-rename-input"
						data-testid={`rename-session-input-${sname}`}
						sx={{
							"& .MuiInputBase-root": {
								bgcolor: "background.paper",
								borderRadius: "var(--radius-sm)",
								fontSize: "var(--font-size-xs)",
								color: "text.primary",
								border: "1px solid",
								borderColor: "primary.main",
								boxShadow: "0 0 0 3px var(--color-accent-subtle)",
								"& fieldset": { border: "none" },
							},
						}}
					/>
				</Box>
			) : (
				<ListItemButton
					className="session-card-body"
					onClick={() => onOpen(sname)}
					data-testid={`session-open-${sname}`}
					selected={isSelected}
					sx={{
						flexDirection: "column",
						alignItems: "stretch",
						gap: "3px",
						py: "6px",
						px: "12px",
						minWidth: 0,
						borderRadius: "var(--radius-md)",
						bgcolor: "transparent",
						transition: "background-color var(--transition-fast)",
						"&.Mui-selected": { bgcolor: "transparent" },
						"&.Mui-selected:hover": { bgcolor: "action.hover" },
						"&:hover": { bgcolor: "action.hover" },
					}}
				>
						<Box className="session-card-name-group">
							<Stack
								direction="row"
								spacing={0.5}
								className="session-card-top"
								sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}
							>
								<Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0, flex: 1 }}>
									<Typography
										className="session-card-name"
										variant="body2"
										title={sname}
										sx={{
											fontSize: "var(--font-size-base)",
											fontWeight: "var(--font-weight-bold)",
											color: "text.primary",
											whiteSpace: "nowrap",
											overflow: "hidden",
											textOverflow: "ellipsis",
											lineHeight: 1.2,
										}}
										noWrap
									>
										{sname}
									</Typography>
								</Stack>
								<Stack
									className="session-card-action-column"
									sx={{ alignItems: "flex-end", flexShrink: 0, ml: "auto" }}
								>
									{session.intelligenceUpdatedAt && (
										<Typography
											className="session-card-time"
											variant="caption"
											sx={{
												fontSize: "var(--font-size-xs)",
												color: "text.secondary",
												ml: "auto",
												textAlign: "right",
												flexShrink: 0,
												opacity: 0.65,
												fontWeight: 500,
												lineHeight: "18px",
												transition: "opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)",
												".session-card:hover &": { opacity: 0 },
											}}
										>
											{formatRelativeTime(session.intelligenceUpdatedAt)}
										</Typography>
									)}
									<Stack
										direction="row"
										spacing={0.5}
										className="session-card-actions"
										sx={{
											alignItems: "center",
											position: "absolute",
											opacity: 0,
											transition: "opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)",
											".session-card:hover &": { opacity: 1 },
										}}
									>
										<SidebarIconButton
											className="session-action-btn"
											icon={CreateNewFolderIcon}
											variant="row"
											onClick={(e) => { e.stopPropagation(); onBuildProject(sname); }}
											aria-label={`Build project from ${sname}`}
											title="Build project"
											data-testid={`build-project-${sname}`}
											sx={{
												color: "text.secondary",
												transition: "color var(--transition-fast), background-color var(--transition-fast), transform var(--transition-spring)",
												"&:hover": {
													bgcolor: "action.hover",
													color: "primary.main",
													transform: "scale(1.1)",
												},
											}}
										/>
										<SidebarIconButton
											className="session-action-btn"
											icon={EditIcon}
											variant="row"
											onClick={(e) => { e.stopPropagation(); handleStartRename(); }}
											aria-label={`Rename ${sname}`}
											title="Rename"
											data-testid={`rename-session-${sname}`}
											sx={{
												color: "text.secondary",
												transition: "color var(--transition-fast), background-color var(--transition-fast), transform var(--transition-spring)",
												"&:hover": {
													bgcolor: "action.hover",
													color: "text.primary",
													transform: "scale(1.1) rotate(-5deg)",
												},
											}}
										/>
										<SidebarIconButton
											className="session-action-btn session-action-danger"
											icon={DeleteIcon}
											variant="row"
											danger
											onClick={(e) => { e.stopPropagation(); onKill(sname); }}
											aria-label={`Kill ${sname}`}
											title="Kill session"
											data-testid={`kill-session-${sname}`}
											sx={{
												color: "text.secondary",
												transition: "color var(--transition-fast), background-color var(--transition-fast), transform var(--transition-spring)",
												"&:hover": {
													bgcolor: "error.main",
													color: "common.white",
													transform: "scale(1.1)",
												},
											}}
										/>
									</Stack>
								</Stack>
							</Stack>
							<Box
								className="session-card-meta"
								sx={{
									display: "flex",
									alignItems: "center",
									flexWrap: "wrap",
									justifyContent: "flex-start",
									minHeight: "18px",
									width: "100%",
									m: 0,
									p: 0,
									gap: "3px",
								}}
							>
								{hasAttention && typeof session.attentionCount === "number" && session.attentionCount > 0 && (
									<Chip
										label={session.attentionCount}
										size="small"
										className={`attention-badge${session.attentionState === "attention" ? " is-soft" : ""}`}
										sx={{ fontSize: "var(--font-size-xs)", minHeight: 18, height: 18 }}
									/>
								)}
								{typeof session.windowCount === "number" && session.windowCount > 0 && (
									<Chip
										label={`${session.windowCount} w`}
										size="small"
										className="window-count-badge"
										sx={{
											fontSize: "var(--font-size-xs)",
											fontWeight: "var(--font-weight-semibold)",
											minHeight: 18,
											height: 18,
											minWidth: 18,
										}}
									/>
								)}
								{hasIntelligence && intelligenceBadgeClass && intelligenceBadgeLabel && (
									<Chip
										label={intelligenceBadgeLabel}
										size="small"
										className={`intelligence-badge is-${intelligenceBadgeClass}`}
										sx={{ fontSize: "var(--font-size-xs)", minHeight: 18, height: 18 }}
									/>
								)}

								{appBadgeEntries.map(([app, count]) => {
									const appClass = KNOWN_APP_BADGES.has(app) ? ` is-${app}` : "";
									return (
										<Chip
											key={app}
											label={`${app} ${count}`}
											size="small"
											className={`app-count-badge${appClass}`}
											sx={{ fontSize: "var(--font-size-xs)", minHeight: 18, height: 18 }}
										/>
									);
								})}
							</Box>
						</Box>
					</ListItemButton>
			)}
		</Box>
	);
}

function formatRelativeTime(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHour = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHour / 24);

	if (diffSec < 60) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	if (diffHour < 24) return `${diffHour}h ago`;
	if (diffDay < 7) return `${diffDay}d ago`;
	return date.toLocaleDateString();
}

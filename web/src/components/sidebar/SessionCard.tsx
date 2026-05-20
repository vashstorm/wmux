import { useState } from "react";
import {
	Box,
	Stack,
	Chip,
	IconButton,
	Typography,
	TextField,
	ListItemButton,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { alpha } from "@mui/material/styles";
import type { SessionInfoData } from "../../api/client.js";

const INTELLIGENCE_STATUS_LABELS: Record<string, string> = {
	waiting: "Waiting",
	dead_loop: "Loop",
	blocked: "Blocked",
	waiting_confirm: "Confirm",
	waiting_idle: "Idle",
	running: "Running",
};

const APP_BADGE_ORDER = ["claude", "codex", "opencode", "zsh"] as const;

interface SessionCardProps {
	session: SessionInfoData;
	isSelected: boolean;
	onOpen: (sessionName: string) => void;
	onRename: (sessionName: string) => void;
	onKill: (sessionName: string) => void;
	onSubmitRename: (sessionName: string, newName: string) => Promise<void>;
}

export function SessionCard({
	session,
	isSelected,
	onOpen,
	onRename,
	onKill,
	onSubmitRename,
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

	return (
		<Box
			className={`session-card${session.attentionState === "explicit" ? " is-attention-explicit" : ""}${session.attentionState === "attention" ? " is-attention" : ""}${isSelected ? " is-selected" : ""}`}
			data-testid={`session-card-${sname}`}
			sx={{
				mb: 0.75,
				borderRadius: "var(--radius-md)",
				border: "1px solid",
				borderColor: isSelected
					? "var(--color-session-card-selected-border)"
					: "var(--color-session-card-border)",
				bgcolor: isSelected
					? "var(--color-session-card-selected)"
					: "var(--color-session-card-bg)",
				transition: "border-color 200ms ease, background-color 200ms ease, box-shadow 200ms ease",
				boxShadow: isSelected
					? "0 0 0 1px var(--color-session-card-selected-border), var(--shadow-sm)"
					: "none",
				position: "relative",
				overflow: "hidden",
				...(session.attentionState === "explicit" && {
					borderColor: "var(--color-attention-explicit)",
					boxShadow: "0 0 0 1px var(--color-attention-explicit)",
				}),
				...(session.attentionState === "attention" && !isSelected && {
					borderColor: "var(--color-attention)",
				}),
			}}
		>
			{isRenaming ? (
				<Box className="session-card-rename" sx={{ p: "var(--spacing-sm)" }}>
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
								"& fieldset": { border: "none" },
							},
						}}
					/>
				</Box>
			) : (
				<Box sx={{ display: "flex", alignItems: "center", position: "relative" }}>
					<ListItemButton
						className="session-card-body"
						onClick={() => onOpen(sname)}
						data-testid={`session-open-${sname}`}
						selected={isSelected}
						sx={{
							flexDirection: "column",
							alignItems: "stretch",
							gap: "6px",
							py: "12px",
							px: "14px",
							minWidth: 0,
							borderRadius: "var(--radius-md)",
							bgcolor: "transparent",
							transition: "background-color 150ms ease",
							"&.Mui-selected": { bgcolor: "transparent" },
							"&.Mui-selected:hover": { bgcolor: "action.hover" },
							"&:hover": { bgcolor: "action.hover" },
						}}
					>
						<Box className="session-card-name-group">
							<Stack
								direction="row"
								spacing={1}
								className="session-card-top"
								sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}
							>
								<Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0, flex: 1 }}>
									<Typography
										className="session-card-name"
										variant="body2"
										title={sname}
										sx={{
											fontSize: "var(--font-size-sm)",
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
									{typeof session.windowCount === "number" && session.windowCount > 0 && (
										<Chip
											label={`${session.windowCount} w`}
											size="small"
											className="window-count-badge"
											sx={{
												fontSize: "10px",
												fontWeight: "var(--font-weight-semibold)",
												color: "text.secondary",
												bgcolor: "action.hover",
												border: "1px solid",
												borderColor: "divider",
												minHeight: 18,
												height: 18,
												minWidth: 18,
											}}
										/>
									)}
									{hasIntelligence && (
										<Chip
											label={
												session.intelligenceError
													? "Error"
													: INTELLIGENCE_STATUS_LABELS[session.intelligenceStatus ?? ""] ?? session.intelligenceStatus
											}
											size="small"
											className={`intelligence-badge${session.intelligenceError ? " is-error" : session.intelligenceStatus ? ` is-${session.intelligenceStatus}` : ""}`}
											sx={{
												fontSize: "10px",
												fontWeight: "var(--font-weight-semibold)",
												minHeight: 18,
												height: 18,
											}}
										/>
									)}
								</Stack>
								{session.intelligenceUpdatedAt && (
									<Typography
										className="session-card-time"
										variant="caption"
										sx={{
											fontSize: "10px",
											color: "text.secondary",
											flexShrink: 0,
											opacity: 0.6,
											fontWeight: 500,
										}}
									>
										{formatRelativeTime(session.intelligenceUpdatedAt)}
									</Typography>
								)}
							</Stack>
							{session.intelligenceSummary && (
								<Typography
									component="p"
									className="session-intelligence-summary"
									title={`${session.intelligenceSummary}${session.intelligenceError ? " [error]" : ""}${session.intelligenceStale ? " [stale]" : ""}${session.intelligenceSource ? ` via ${session.intelligenceSource}` : ""}`}
									sx={{
										fontSize: "11px",
										color: "text.secondary",
										m: "2px 0",
										display: "-webkit-box",
										WebkitLineClamp: 2,
										WebkitBoxOrient: "vertical",
										overflow: "hidden",
										textOverflow: "ellipsis",
										maxWidth: "100%",
										opacity: 0.9,
										fontFamily: "var(--font-stack)",
										lineHeight: 1.5,
										py: "4px",
									}}
								>
									{session.intelligenceSummary}
								</Typography>
							)}
							<Stack
								direction="row"
								spacing={1}
								className="session-card-meta"
								sx={{ alignItems: "center", flexWrap: "wrap", minHeight: "18px" }}
							>
								{hasAttention && typeof session.attentionCount === "number" && session.attentionCount > 0 && (
									<Chip
										label={session.attentionCount}
										size="small"
										className={`attention-badge${session.attentionState === "attention" ? " is-soft" : ""}`}
										sx={{ fontSize: "10px", minHeight: 18, height: 18 }}
									/>
								)}
								{session.intelligenceAppCounts && APP_BADGE_ORDER.map((app) => {
									const count = session.intelligenceAppCounts![app];
									if (typeof count !== "number" || count <= 0) return null;
									return (
										<Chip
											key={app}
											label={`${app} ${count}`}
											size="small"
											className={`app-count-badge is-${app}`}
											sx={{ fontSize: "10px", minHeight: 18, height: 18 }}
										/>
									);
								})}
							</Stack>
						</Box>
					</ListItemButton>
					<Stack
						direction="row"
						spacing={0.5}
						className="session-card-actions"
						sx={{
							alignItems: "center",
							position: "absolute",
							right: 0,
							top: 0,
							height: "100%",
							px: "10px",
							opacity: 0,
							transform: "translateX(4px)",
							transition: "opacity 200ms cubic-bezier(0.4, 0, 0.2, 1), transform 200ms cubic-bezier(0.4, 0, 0.2, 1)",
							background: (theme) =>
								`linear-gradient(to left, ${alpha(theme.palette.background.paper, 0.9)} 70%, transparent)`,
							".session-card:hover &": {
								opacity: 1,
								transform: "translateX(0)",
							},
							".session-card.is-selected &": {
								background: (theme) =>
									`linear-gradient(to left, ${alpha(theme.palette.primary.main, 0.08)} 70%, transparent)`,
							},
						}}
					>
						<IconButton
							className="session-action-btn"
							onClick={(e) => { e.stopPropagation(); handleStartRename(); }}
							title="Rename"
							data-testid={`rename-session-${sname}`}
							size="small"
							sx={{
								width: 24,
								height: 24,
								color: "text.secondary",
								"&:hover": { bgcolor: "action.hover", color: "text.primary" },
							}}
						>
							<EditIcon sx={{ fontSize: 14 }} />
						</IconButton>
						<IconButton
							className="session-action-btn session-action-danger"
							onClick={(e) => { e.stopPropagation(); onKill(sname); }}
							title="Kill session"
							data-testid={`kill-session-${sname}`}
							size="small"
							sx={{
								width: 24,
								height: 24,
								color: "text.secondary",
								"&:hover": { bgcolor: "error.main", color: "common.white" },
							}}
						>
							<DeleteIcon sx={{ fontSize: 14 }} />
						</IconButton>
					</Stack>
				</Box>
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
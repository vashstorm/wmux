import { useRef, useState } from "react";
import {
	Box,
	Stack,
	Typography,
	TextField,
	ListItemButton,
	Tooltip,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import type { SessionInfoData } from "../../api/client.js";
import { SidebarIconButton } from "./SidebarIconButton.js";

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
	const nameRef = useRef<HTMLSpanElement | null>(null);
	const [isNameOverflowing, setIsNameOverflowing] = useState(false);

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

	const updateNameOverflow = () => {
		const nameElement = nameRef.current;
		if (!nameElement) return;
		setIsNameOverflowing(nameElement.scrollWidth > nameElement.clientWidth + 1);
	};

	return (
		<Box
			className={`session-card${isSelected ? " is-selected" : ""}`}
			data-testid={`session-card-${sname}`}
			sx={{
				width: "100%",
				borderRadius: "var(--radius-md)",
				border: "1px solid",
				borderColor: isSelected
					? "var(--color-session-card-selected-border)"
					: "var(--color-session-card-border)",
				bgcolor: isSelected
					? "var(--color-session-card-selected)"
					: "var(--color-session-card-bg)",
				backgroundImage: isSelected
					? "linear-gradient(135deg, var(--color-accent-subtle) 0%, transparent 60%)"
					: "none",
				boxShadow: isSelected
					? "var(--color-session-card-selected-glow)"
					: "none",
				transition: [
					"border-color var(--transition-base)",
					"background-color var(--transition-base)",
					"box-shadow var(--transition-base)",
					"transform var(--transition-base)",
				].join(", "),
				position: "relative",
				overflow: "hidden",
				// Left accent indicator bar
				"&::before": {
					content: '""',
					position: "absolute",
					left: 0,
					top: "18%",
					bottom: "18%",
					width: "2px",
					borderRadius: "0 2px 2px 0",
					bgcolor: isSelected ? "var(--color-accent)" : "transparent",
					transition: [
						"background-color var(--transition-base)",
						"top var(--transition-spring)",
						"bottom var(--transition-spring)",
					].join(", "),
				},
				"&:hover::before": {
					bgcolor: isSelected
						? "var(--color-accent)"
						: "var(--color-surface-border-hover)",
					top: "8%",
					bottom: "8%",
				},
				"&:hover": {
					borderColor: isSelected
						? "var(--color-session-card-selected-border)"
						: "var(--color-surface-border-hover)",
					boxShadow: isSelected
						? "var(--color-session-card-selected-glow)"
						: "var(--shadow-sm)",
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
								fontFamily: "var(--font-mono)",
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
						flexDirection: "row",
						alignItems: "center",
						gap: "6px",
						py: "7px",
						pl: "16px",
						pr: "12px",
						minWidth: 0,
						borderRadius: "var(--radius-md)",
						bgcolor: "transparent",
						transition: "background-color var(--transition-fast)",
						"&.Mui-selected": { bgcolor: "transparent" },
						"&.Mui-selected:hover": { bgcolor: "transparent" },
						"&:hover": { bgcolor: "transparent" },
					}}
				>
					{/* Prompt glyph + name */}
					<Box
						sx={{
							flex: 1,
							minWidth: 0,
							display: "flex",
							alignItems: "center",
							gap: "5px",
							transition: "padding-right var(--transition-spring)",
							".session-card:hover &": {
								paddingRight: "90px",
							},
						}}
					>
						<Typography
							component="span"
							sx={{
								fontFamily: "var(--font-mono)",
								fontSize: "9px",
								color: isSelected
									? "var(--color-accent)"
									: "var(--color-text-disabled)",
								flexShrink: 0,
								lineHeight: 1,
								transition: "color var(--transition-base)",
								userSelect: "none",
								"& ~ *": {},
								".session-card:hover &": {
									color: isSelected
										? "var(--color-accent)"
										: "var(--color-text-muted)",
								},
							}}
						>
							❯
						</Typography>
						<Tooltip
							title={isNameOverflowing ? sname : ""}
							placement="top-start"
							enterDelay={800}
							disableInteractive
							arrow
							slotProps={{
								popper: {
									modifiers: [
										{
											name: "preventOverflow",
											options: {
												boundary: "viewport",
												padding: 8,
											},
										},
									],
								},
								tooltip: {
									sx: {
										maxWidth: "min(260px, calc(100vw - 16px))",
										overflowWrap: "anywhere",
									},
								},
							}}
						>
							<Typography
								ref={nameRef}
								className="session-card-name"
								variant="body2"
								onMouseEnter={updateNameOverflow}
								onFocus={updateNameOverflow}
								sx={{
									fontFamily: "var(--font-mono)",
									fontSize: "var(--font-size-xs)",
									fontWeight: isSelected
										? "var(--font-weight-semibold)"
										: "var(--font-weight-normal)",
									color: isSelected ? "text.primary" : "text.secondary",
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
									lineHeight: 1.4,
									flex: 1,
									minWidth: 0,
									transition: "color var(--transition-base), font-weight var(--transition-base)",
									".session-card:hover &": {
										color: "text.primary",
									},
								}}
								noWrap
							>
								{sname}
							</Typography>
						</Tooltip>
					</Box>
 
					{/* Compact timestamp */}
					{session.intelligenceUpdatedAt && (
						<Typography
							className="session-card-time"
							component="span"
							sx={{
								flexShrink: 0,
								fontSize: "var(--font-size-2xs)",
								color: "text.disabled",
								fontWeight: 500,
								fontVariantNumeric: "tabular-nums",
								letterSpacing: "0.01em",
								lineHeight: 1,
								transition: "opacity var(--transition-base)",
								".session-card:hover &": { opacity: 0 },
							}}
						>
							{formatRelativeTime(session.intelligenceUpdatedAt)}
						</Typography>
					)}
 
					{/* Hover action buttons — slide in from right */}
					<Stack
						direction="row"
						className="session-card-actions"
						sx={{
							alignItems: "center",
							position: "absolute",
							right: "8px",
							top: "50%",
							transform: "translate(8px, -50%)",
							opacity: 0,
							pointerEvents: "none",
							transition: "opacity var(--transition-base), transform var(--transition-spring)",
							".session-card:hover &": {
								opacity: 1,
								transform: "translate(0, -50%)",
								pointerEvents: "auto",
							},
							display: "flex",
							gap: "2px",
							maxWidth: "calc(100% - 16px)",
							bgcolor: (theme) =>
								theme.palette.mode === "dark"
									? "rgba(20, 26, 38, 0.92)"
									: "rgba(255, 255, 255, 0.92)",
							backdropFilter: "blur(12px) saturate(160%)",
							pl: "4px",
							pr: "4px",
							py: "3px",
							borderRadius: "var(--radius-sm)",
							border: "1px solid",
							borderColor: "divider",
							boxShadow: (theme) =>
								theme.palette.mode === "dark"
									? "0 4px 12px rgba(0,0,0,0.4)"
									: "0 4px 12px rgba(0,0,0,0.08)",
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
								color: "text.disabled",
								width: 24,
								height: 24,
								"& .MuiSvgIcon-root": { fontSize: "14px" },
								transition: "color var(--transition-fast), background-color var(--transition-fast), transform var(--transition-spring)",
								"&:hover": {
									bgcolor: "action.hover",
									color: "primary.main",
									transform: "scale(1.2)",
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
								color: "text.disabled",
								width: 24,
								height: 24,
								"& .MuiSvgIcon-root": { fontSize: "14px" },
								transition: "color var(--transition-fast), background-color var(--transition-fast), transform var(--transition-spring)",
								"&:hover": {
									bgcolor: "action.hover",
									color: "text.primary",
									transform: "scale(1.2) rotate(-8deg)",
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
								color: "text.disabled",
								width: 24,
								height: 24,
								"& .MuiSvgIcon-root": { fontSize: "14px" },
								transition: "color var(--transition-fast), background-color var(--transition-fast), transform var(--transition-spring)",
								"&:hover": {
									bgcolor: "error.main",
									color: "common.white",
									transform: "scale(1.2)",
								},
							}}
						/>
					</Stack>
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

	if (diffSec < 60) return "now";
	if (diffMin < 60) return `${diffMin}m`;
	if (diffHour < 24) return `${diffHour}h`;
	if (diffDay < 7) return `${diffDay}d`;
	return date.toLocaleDateString();
}

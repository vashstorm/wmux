import { Stack, IconButton, Typography, Box } from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import TerminalIcon from "@mui/icons-material/Terminal";
import BarChartIcon from "@mui/icons-material/BarChart";
import { alpha } from "@mui/material/styles";

type SidebarView = "projects" | "session" | "stats";

interface SidebarHeaderProps {
	activeView: SidebarView;
	onViewChange: (view: SidebarView) => void;
}

export function SidebarHeader({ activeView, onViewChange }: SidebarHeaderProps) {
	return (
		<Box
			className="sidebar-header"
			sx={{
				minHeight: "var(--app-shell-header-height, 42px)",
				display: "flex",
				alignItems: "center",
				px: "var(--spacing-md)",
				borderBottom: "1px solid",
				borderColor: "divider",
				background: (theme) =>
					`linear-gradient(to bottom, ${alpha(theme.palette.common.white, theme.palette.mode === "dark" ? 0.04 : 0.8)}, transparent)`,
				flexShrink: 0,
			}}
		>
			<Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", width: "100%", gap: 0.5 }}>
				<Typography
					className="sidebar-brand"
					variant="subtitle1"
					sx={{
						fontFamily: "var(--font-display)",
						fontSize: "var(--font-size-md)",
						fontWeight: "var(--font-weight-bold)",
						color: "primary.main",
						textTransform: "uppercase",
						letterSpacing: "0.15em",
						flexShrink: 0,
						mr: 0.5,
					}}
				>
					Wmux
				</Typography>

				{/* Nav view tabs */}
				<Stack direction="row" sx={{ alignItems: "center", gap: 0.25 }}>
					<IconButton
						className={`sidebar-header-action${activeView === "projects" ? " is-active" : ""}`}
						onClick={() => onViewChange("projects")}
						data-testid="open-projects-button"
						aria-label="Projects"
						title="Projects"
						size="small"
						sx={{
							width: 28, height: 28,
							borderRadius: "var(--radius-sm)",
							color: activeView === "projects" ? "primary.main" : "text.secondary",
							bgcolor: activeView === "projects" ? (theme) => alpha(theme.palette.primary.main, 0.1) : "transparent",
							"&:hover": { color: "primary.main", bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1) },
						}}
					>
						<FolderIcon sx={{ fontSize: 16 }} />
					</IconButton>
					<IconButton
						className={`sidebar-header-action${activeView === "session" ? " is-active" : ""}`}
						onClick={() => onViewChange("session")}
						data-testid="open-session-button"
						aria-label="Session"
						title="Session"
						size="small"
						sx={{
							width: 28, height: 28,
							borderRadius: "var(--radius-sm)",
							color: activeView === "session" ? "primary.main" : "text.secondary",
							bgcolor: activeView === "session" ? (theme) => alpha(theme.palette.primary.main, 0.1) : "transparent",
							"&:hover": { color: "primary.main", bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1) },
						}}
					>
						<TerminalIcon sx={{ fontSize: 16 }} />
					</IconButton>
					<IconButton
						className={`sidebar-header-action${activeView === "stats" ? " is-active" : ""}`}
						onClick={() => onViewChange("stats")}
						data-testid="open-stats-button"
						aria-label="Stats"
						title="Stats"
						size="small"
						sx={{
							width: 28, height: 28,
							borderRadius: "var(--radius-sm)",
							color: activeView === "stats" ? "primary.main" : "text.secondary",
							bgcolor: activeView === "stats" ? (theme) => alpha(theme.palette.primary.main, 0.1) : "transparent",
							"&:hover": { color: "primary.main", bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1) },
						}}
					>
						<BarChartIcon sx={{ fontSize: 16 }} />
					</IconButton>
				</Stack>
			</Stack>
		</Box>
	);
}
import type { ElementType } from "react";
import { Box, Tabs, Tab, Stack, Typography, keyframes } from "@mui/material";
import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import CodeIcon from "@mui/icons-material/Code";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import TerminalIcon from "@mui/icons-material/Terminal";
import type { PaneData, WindowSummary } from "../state/store.js";

interface WindowTabsProps {
	windows: WindowSummary[];
	loadedPanesByWindow?: Record<string, PaneData[]>;
	selectedWindowId: string | null;
	onSelectWindow: (windowId: string, activePaneId: string) => void;
}

interface AppIconConfig {
	label: string;
	Icon: ElementType<SvgIconProps>;
	color: string;
	backgroundColor: string;
}

type TabStatusName = "explicit" | "attention" | "running" | "waiting" | "blocked" | "none";

interface TabStatusTone {
	name: TabStatusName;
	color: string;
	backgroundColor: string;
	selectedBackgroundColor: string;
	softBorderColor: string;
}

function ClaudeLogoIcon(props: SvgIconProps) {
	return (
		<SvgIcon viewBox="0 0 125 125" {...props}>
			<path
				d="M54.375 118.75L56.125 111L58.125 101L59.75 93L61.25 83.125L62.125 79.875L62 79.625L61.375 79.75L53.875 90L42.5 105.375L33.5 114.875L31.375 115.75L27.625 113.875L28 110.375L30.125 107.375L42.5 91.5L50 81.625L54.875 76L54.75 75.25H54.5L21.5 96.75L15.625 97.5L13 95.125L13.375 91.25L14.625 90L24.5 83.125L49.125 69.375L49.5 68.125L49.125 67.5H47.875L43.75 67.25L29.75 66.875L17.625 66.375L5.75 65.75L2.75 65.125L0 61.375L0.25 59.5L2.75 57.875L6.375 58.125L14.25 58.75L26.125 59.5L34.75 60L47.5 61.375H49.5L49.75 60.5L49.125 60L48.625 59.5L36.25 51.25L23 42.5L16 37.375L12.25 34.75L10.375 32.375L9.625 27.125L13 23.375L17.625 23.75L18.75 24L23.375 27.625L33.25 35.25L46.25 44.875L48.125 46.375L49 45.875V45.5L48.125 44.125L41.125 31.375L33.625 18.375L30.25 13L29.375 9.75C29.0417 8.625 28.875 7.375 28.875 6L32.75 0.75L34.875 0L40.125 0.75L42.25 2.625L45.5 10L50.625 21.625L58.75 37.375L61.125 42.125L62.375 46.375L62.875 47.75H63.75V47L64.375 38L65.625 27.125L66.875 13.125L67.25 9.125L69.25 4.375L73.125 1.875L76.125 3.25L78.625 6.875L78.25 9.125L76.875 18.75L73.875 33.875L72 44.125H73.125L74.375 42.75L79.5 36L88.125 25.25L91.875 21L96.375 16.25L99.25 14H104.625L108.5 19.875L106.75 26L101.25 33L96.625 38.875L90 47.75L86 54.875L86.375 55.375H87.25L102.125 52.125L110.25 50.75L119.75 49.125L124.125 51.125L124.625 53.125L122.875 57.375L112.625 59.875L100.625 62.25L82.75 66.5L82.5 66.625L82.75 67L90.75 67.75L94.25 68H102.75L118.5 69.125L122.625 71.875L125 75.125L124.625 77.75L118.25 80.875L109.75 78.875L89.75 74.125L83 72.5H82V73L87.75 78.625L98.125 88L111.25 100.125L111.875 103.125L110.25 105.625L108.5 105.375L97 96.625L92.5 92.75L82.5 84.375H81.875V85.25L84.125 88.625L96.375 107L97 112.625L96.125 114.375L92.875 115.5L89.5 114.875L82.25 104.875L74.875 93.5L68.875 83.375L68.25 83.875L64.625 121.625L63 123.5L59.25 125L56.125 122.625L54.375 118.75Z"
				fill="currentColor"
			/>
		</SvgIcon>
	);
}

function OpenCodeLogoIcon(props: SvgIconProps) {
	return (
		<SvgIcon viewBox="0 0 300 300" {...props}>
			<path d="M210 240H90V120H210V240Z" fill="#cfcecd" />
			<path d="M210 60H90V240H210V60ZM270 300H30V0H270V300Z" fill="currentColor" />
		</SvgIcon>
	);
}

function OpenAILogoIcon(props: SvgIconProps) {
	return (
		<SvgIcon viewBox="0 0 41 41" {...props}>
			<path
				d="M37.5324 16.8707C37.9808 15.5241 38.1363 14.0974 37.9886 12.6859C37.8409 11.2744 37.3934 9.91076 36.676 8.68622C35.6126 6.83404 33.9882 5.3676 32.0373 4.4985C30.0864 3.62941 27.9098 3.40259 25.8215 3.85078C24.8796 2.7893 23.7219 1.94125 22.4257 1.36341C21.1295 0.785575 19.7249 0.491269 18.3058 0.500197C16.1708 0.495044 14.0893 1.16803 12.3614 2.42214C10.6335 3.67624 9.34853 5.44666 8.6917 7.47815C7.30085 7.76286 5.98686 8.3414 4.8377 9.17505C3.68854 10.0087 2.73073 11.0782 2.02839 12.312C0.956464 14.1591 0.498905 16.2988 0.721698 18.4228C0.944492 20.5467 1.83612 22.5449 3.268 24.1293C2.81966 25.4759 2.66413 26.9026 2.81182 28.3141C2.95951 29.7256 3.40701 31.0892 4.12437 32.3138C5.18791 34.1659 6.8123 35.6322 8.76321 36.5013C10.7141 37.3704 12.8907 37.5973 14.9789 37.1492C15.9208 38.2107 17.0786 39.0587 18.3747 39.6366C19.6709 40.2144 21.0755 40.5087 22.4946 40.4998C24.6307 40.5054 26.7133 39.8321 28.4418 38.5772C30.1704 37.3223 31.4556 35.5506 32.1119 33.5179C33.5027 33.2332 34.8167 32.6547 35.9659 31.821C37.115 30.9874 38.0728 29.9178 38.7752 28.684C39.8458 26.8371 40.3023 24.6979 40.0789 22.5748C39.8556 20.4517 38.9639 18.4544 37.5324 16.8707ZM22.4978 37.8849C20.7443 37.8874 19.0459 37.2733 17.6994 36.1501C17.7601 36.117 17.8666 36.0586 17.936 36.0161L25.9004 31.4156C26.1003 31.3019 26.2663 31.137 26.3813 30.9378C26.4964 30.7386 26.5563 30.5124 26.5549 30.2825V19.0542L29.9213 20.998C29.9389 21.0068 29.9541 21.0198 29.9656 21.0359C29.977 21.052 29.9842 21.0707 29.9867 21.0902V30.3889C29.9842 32.375 29.1946 34.2791 27.7909 35.6841C26.3872 37.0892 24.4838 37.8806 22.4978 37.8849ZM6.39227 31.0064C5.51397 29.4888 5.19742 27.7107 5.49804 25.9832C5.55718 26.0187 5.66048 26.0818 5.73461 26.1244L13.699 30.7248C13.8975 30.8408 14.1233 30.902 14.3532 30.902C14.583 30.902 14.8088 30.8408 15.0073 30.7248L24.731 25.1103V28.9979C24.7321 29.0177 24.7283 29.0376 24.7199 29.0556C24.7115 29.0736 24.6988 29.0893 24.6829 29.1012L16.6317 33.7497C14.9096 34.7416 12.8643 35.0097 10.9447 34.4954C9.02506 33.9811 7.38785 32.7263 6.39227 31.0064ZM4.29707 13.6194C5.17156 12.0998 6.55279 10.9364 8.19885 10.3327C8.19885 10.4013 8.19491 10.5228 8.19491 10.6071V19.808C8.19351 20.0378 8.25334 20.2638 8.36823 20.4629C8.48312 20.6619 8.64893 20.8267 8.84863 20.9404L18.5723 26.5542L15.206 28.4979C15.1894 28.5089 15.1703 28.5155 15.1505 28.5173C15.1307 28.5191 15.1107 28.516 15.0924 28.5082L7.04046 23.8557C5.32135 22.8601 4.06716 21.2235 3.55289 19.3046C3.03862 17.3858 3.30624 15.3413 4.29707 13.6194ZM31.955 20.0556L22.2312 14.4411L25.5976 12.4981C25.6142 12.4872 25.6333 12.4805 25.6531 12.4787C25.6729 12.4769 25.6928 12.4801 25.7111 12.4879L33.7631 17.1364C34.9967 17.849 36.0017 18.8982 36.6606 20.1613C37.3194 21.4244 37.6047 22.849 37.4832 24.2684C37.3617 25.6878 36.8382 27.0432 35.9743 28.1759C35.1103 29.3086 33.9415 30.1717 32.6047 30.6641C32.6047 30.5947 32.6047 30.4733 32.6047 30.3889V21.188C32.6066 20.9586 32.5474 20.7328 32.4332 20.5338C32.319 20.3348 32.154 20.1698 31.955 20.0556ZM35.3055 15.0128C35.2464 14.9765 35.1431 14.9142 35.069 14.8717L27.1045 10.2712C26.906 10.1554 26.6803 10.0943 26.4504 10.0943C26.2206 10.0943 25.9948 10.1554 25.7963 10.2712L16.0726 15.8858V11.9982C16.0715 11.9783 16.0753 11.9585 16.0837 11.9405C16.0921 11.9225 16.1048 11.9068 16.1207 11.8949L24.1719 7.25025C25.4053 6.53903 26.8158 6.19376 28.2383 6.25482C29.6608 6.31589 31.0364 6.78077 32.2044 7.59508C33.3723 8.40939 34.2842 9.53945 34.8334 10.8531C35.3826 12.1667 35.5464 13.6095 35.3055 15.0128ZM14.2424 21.9419L10.8752 19.9981C10.8576 19.9893 10.8423 19.9763 10.8309 19.9602C10.8195 19.9441 10.8122 19.9254 10.8098 19.9058V10.6071C10.8107 9.18295 11.2173 7.78848 11.9819 6.58696C12.7466 5.38544 13.8377 4.42659 15.1275 3.82264C16.4173 3.21869 17.8524 2.99464 19.2649 3.1767C20.6775 3.35876 22.0089 3.93941 23.1034 4.85067C23.0427 4.88379 22.937 4.94215 22.8668 4.98473L14.9024 9.58517C14.7025 9.69878 14.5366 9.86356 14.4215 10.0626C14.3065 10.2616 14.2466 10.4877 14.2479 10.7175L14.2424 21.9419ZM16.071 17.9991L20.4018 15.4978L24.7325 17.9975V22.9985L20.4018 25.4983L16.071 22.9985V17.9991Z"
				fill="currentColor"
			/>
		</SvgIcon>
	);
}

function inferAppNameFromText(value: string | undefined): string | null {
	const normalized = value?.trim().toLowerCase() ?? "";
	if (!normalized) {
		return null;
	}
	if (normalized.includes("claude")) {
		return "claude";
	}
	if (normalized.includes("codex")) {
		return "codex";
	}
	if (normalized === "zsh" || normalized.includes(" zsh") || normalized.startsWith("zsh ")) {
		return "zsh";
	}
	return null;
}

function normalizeAppName(value: string | undefined): string | null {
	const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
	return normalized || null;
}

function inferIconAppNameFromText(value: string | undefined): string | null {
	const normalized = normalizeAppName(value);
	if (!normalized) {
		return null;
	}
	if (normalized.includes("claude")) {
		return "claude";
	}
	if (normalized.includes("opencode") || normalized.includes("open_code")) {
		return "opencode";
	}
	if (normalized.includes("codex")) {
		return "codex";
	}
	if (normalized === "zsh" || normalized.startsWith("zsh_") || normalized.endsWith("_zsh")) {
		return "zsh";
	}
	if (normalized === "python" || normalized === "python3" || normalized.startsWith("python_") || normalized.includes("ipython")) {
		return "python";
	}
	if (normalized === "bash" || normalized === "sh" || normalized.includes("_bash")) {
		return "shell";
	}
	return null;
}

const appIconConfigs: Record<string, AppIconConfig> = {
	claude: {
		label: "Claude",
		Icon: ClaudeLogoIcon,
		color: "#d97757",
		backgroundColor: "rgba(217, 119, 87, 0.13)",
	},
	opencode: {
		label: "OpenCode",
		Icon: OpenCodeLogoIcon,
		color: "#211e1e",
		backgroundColor: "rgba(207, 206, 205, 0.24)",
	},
	codex: {
		label: "Codex",
		Icon: OpenAILogoIcon,
		color: "#10a37f",
		backgroundColor: "rgba(16, 163, 127, 0.13)",
	},
	zsh: {
		label: "zsh",
		Icon: TerminalIcon,
		color: "#64748b",
		backgroundColor: "rgba(100, 116, 139, 0.16)",
	},
	python: {
		label: "Python",
		Icon: CodeIcon,
		color: "#3776ab",
		backgroundColor: "rgba(55, 118, 171, 0.14)",
	},
	shell: {
		label: "Shell",
		Icon: TerminalIcon,
		color: "#64748b",
		backgroundColor: "rgba(100, 116, 139, 0.16)",
	},
	unknown: {
		label: "App",
		Icon: SmartToyIcon,
		color: "#7c3aed",
		backgroundColor: "rgba(124, 58, 237, 0.12)",
	},
};

const tabStatusTones: Record<TabStatusName, TabStatusTone> = {
	explicit: {
		name: "explicit",
		color: "var(--color-attention-explicit)",
		backgroundColor: "rgba(220, 38, 38, 0.08)",
		selectedBackgroundColor: "rgba(220, 38, 38, 0.12)",
		softBorderColor: "rgba(220, 38, 38, 0.38)",
	},
	attention: {
		name: "attention",
		color: "var(--color-attention)",
		backgroundColor: "rgba(217, 119, 6, 0.08)",
		selectedBackgroundColor: "rgba(217, 119, 6, 0.12)",
		softBorderColor: "rgba(217, 119, 6, 0.38)",
	},
	running: {
		name: "running",
		color: "var(--color-success)",
		backgroundColor: "rgba(16, 185, 129, 0.08)",
		selectedBackgroundColor: "rgba(16, 185, 129, 0.12)",
		softBorderColor: "rgba(16, 185, 129, 0.34)",
	},
	waiting: {
		name: "waiting",
		color: "var(--color-warning)",
		backgroundColor: "rgba(245, 158, 11, 0.08)",
		selectedBackgroundColor: "rgba(245, 158, 11, 0.12)",
		softBorderColor: "rgba(245, 158, 11, 0.34)",
	},
	blocked: {
		name: "blocked",
		color: "var(--color-danger)",
		backgroundColor: "rgba(239, 68, 68, 0.08)",
		selectedBackgroundColor: "rgba(239, 68, 68, 0.12)",
		softBorderColor: "rgba(239, 68, 68, 0.34)",
	},
	none: {
		name: "none",
		color: "primary.main",
		backgroundColor: "background.paper",
		selectedBackgroundColor: "action.selected",
		softBorderColor: "divider",
	},
};

const pulseAnimation = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
  70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
`;

function getAppCountsFromPanes(panes: PaneData[] | undefined): Record<string, number> {
	if (!panes || panes.length === 0) {
		return {};
	}

	const counts: Record<string, number> = {};
	for (const pane of panes) {
		const app = pane.intelligenceApp?.trim().toLowerCase() ?? inferAppNameFromText(pane.title);
		if (!app) {
			continue;
		}
		counts[app] = (counts[app] ?? 0) + 1;
	}
	return counts;
}

function getPrimaryAppName(
	window: WindowSummary,
	panes: PaneData[] | undefined,
): string | null {
	const activePane = panes?.find((pane) => pane.active);
	const firstPane = panes?.[0];
	const paneAppCounts = getAppCountsFromPanes(panes);
	const appCounts = Object.keys(paneAppCounts).length > 0
		? paneAppCounts
		: (window.intelligenceAppCounts ?? {});
	const rankedApp = Object.entries(appCounts)
		.filter(([, count]) => typeof count === "number" && count > 0)
		.sort((left, right) => right[1] - left[1])[0]?.[0];
	const candidates = [
		rankedApp,
		window.intelligenceApp,
		activePane?.intelligenceApp,
		activePane?.title,
		firstPane?.intelligenceApp,
		firstPane?.title,
		window.activePaneTitle,
		window.name,
	];

	for (const candidate of candidates) {
		const normalized = normalizeAppName(candidate);
		const inferred = inferIconAppNameFromText(candidate);
		if (inferred) {
			return inferred;
		}
		if (normalized && appIconConfigs[normalized]) {
			return normalized;
		}
	}

	return null;
}

function getAppIconConfig(appName: string | null): AppIconConfig | null {
	if (!appName) {
		return null;
	}
	return appIconConfigs[appName] ?? appIconConfigs.unknown ?? null;
}

function getWindowDisplayName(
	window: WindowSummary,
	panes: PaneData[] | undefined,
): string {
	const paneAppCounts = getAppCountsFromPanes(panes);
	const appCounts = Object.keys(paneAppCounts).length > 0
		? paneAppCounts
		: (window.intelligenceAppCounts ?? {});
	const rankedApps = Object.entries(appCounts)
		.filter(([, count]) => typeof count === "number" && count > 0)
		.sort((left, right) => right[1] - left[1]);
	const aiApps = rankedApps
		.map(([app]) => app)
		.filter((app) => app !== "zsh");

	if (aiApps.length >= 2) {
		return "AI CLI";
	}
	if (aiApps.length === 1) {
		return aiApps[0] ?? window.name;
	}
	if ((appCounts.zsh ?? 0) > 0) {
		return "zsh";
	}

	if (window.intelligenceApp && window.intelligenceApp !== "zsh") {
		return window.intelligenceApp;
	}
	if (window.intelligenceApp === "zsh") {
		return "zsh";
	}
	const inferredActivePaneApp = inferAppNameFromText(window.activePaneTitle);
	if (inferredActivePaneApp) {
		return inferredActivePaneApp;
	}
	return window.name;
}

function getStatusTone(window: WindowSummary): TabStatusTone {
	if (window.attentionState === "explicit") {
		return tabStatusTones.explicit;
	}
	if (window.attentionState === "attention") {
		return tabStatusTones.attention;
	}

	const status = normalizeAppName(window.intelligenceStatus);
	if (!status || status === "none") {
		return tabStatusTones.none;
	}
	if (status === "running") {
		return tabStatusTones.running;
	}
	if (status === "blocked" || status === "dead_loop") {
		return tabStatusTones.blocked;
	}
	if (status === "waiting" || status === "waiting_confirm" || status === "waiting_idle") {
		return tabStatusTones.waiting;
	}
	return tabStatusTones.none;
}

export function WindowTabs({
	windows,
	loadedPanesByWindow,
	selectedWindowId,
	onSelectWindow,
}: WindowTabsProps) {
	if (windows.length === 0) {
		return null;
	}

	const tabValue = selectedWindowId && windows.some((window) => window.id === selectedWindowId)
		? selectedWindowId
		: false;

	const handleTabChange = (_event: React.SyntheticEvent, newValue: string | false) => {
		if (typeof newValue !== "string") {
			return;
		}

		const w = windows.find((window) => window.id === newValue);
		if (w) {
			onSelectWindow(w.id, w.activePaneID);
		}
	};

	const tabSxBase = {
		minHeight: 34,
		height: 34,
		padding: "0 13px",
		textTransform: "none" as const,
		borderRadius: "8px",
		gap: 1,
		flexDirection: "row" as const,
		flexShrink: 0,
		minWidth: "auto",
		overflow: "visible",
	};

	return (
		<Box className="window-tabs" data-testid="window-tabs" sx={{
			display: "flex",
			alignItems: "center",
			minHeight: 52,
			paddingX: "calc(var(--spacing-lg) - 6px)",
			paddingY: 0,
			background: (theme) =>
				theme.palette.mode === "dark"
					? "rgba(13, 17, 23, 0.85)"
					: "rgba(250, 251, 253, 0.92)",
			backdropFilter: "blur(16px) saturate(180%)",
			WebkitBackdropFilter: "blur(16px) saturate(180%)",
			borderBottom: "1px solid",
			borderColor: (theme) =>
				theme.palette.mode === "dark"
					? "rgba(255,255,255,0.06)"
					: "rgba(0,0,0,0.07)",
			boxShadow: (theme) =>
				theme.palette.mode === "dark"
					? "0 1px 0 rgba(255,255,255,0.04), 0 4px 16px rgba(0,0,0,0.28)"
					: "0 1px 0 rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.05)",
			flexShrink: 0,
		}}>
			<Tabs
				variant="scrollable"
				scrollButtons={false}
				value={tabValue}
				onChange={handleTabChange}
				sx={{
					minHeight: "unset",
					width: "100%",
					overflow: "hidden",
					"& .MuiTabs-scroller": {
						overflow: "auto hidden !important",
						paddingTop: "9px",
						paddingBottom: "9px",
					},
					"& .MuiTabs-indicator": {
						display: "none",
					},
					"& .MuiTabs-flexContainer": {
						gap: "0px",
						alignItems: "center",
						paddingLeft: "6px",
						paddingRight: "6px",
					},
				}}
			>
				{windows.map((window, index) => {
					const isActive = window.id === selectedWindowId;
					const isAttentionExplicit = window.attentionState === "explicit";
					const isAttention = window.attentionState === "attention";
					const panes = loadedPanesByWindow?.[window.id];
					const displayName = getWindowDisplayName(
						window,
						panes,
					);
					const appName = getPrimaryAppName(window, panes);
					const appConfig = getAppIconConfig(appName);
					const AppIcon = appConfig?.Icon;
					const statusTone = getStatusTone(window);
					const hasNonDefaultStatus = statusTone.name !== "none";
					const tabClasses = [
						"window-tab",
						isActive && "is-active",
						isAttentionExplicit && "is-attention-explicit",
						isAttention && !isAttentionExplicit && "is-attention",
						`status-${statusTone.name}`,
					].filter(Boolean).join(" ");

					const hasAttentionBadge = (isAttention || isAttentionExplicit)
						&& typeof window.attentionCount === "number"
						&& window.attentionCount > 0;

					return (
						<Tab
							key={window.id}
							value={window.id}
							data-testid={isActive ? "window-tab-active" : "window-tab"}
							className={tabClasses}
							title={displayName}
							disableRipple
							disableFocusRipple
							sx={{
								...tabSxBase,
								position: "relative",
								maxWidth: isActive ? 260 : 160,
								marginRight: "8px",
								/* Active tab: filled background with subtle gradient */
								background: isActive
									? (theme) => hasNonDefaultStatus
										? statusTone.selectedBackgroundColor
										: theme.palette.mode === "dark"
											? "rgba(107, 130, 245, 0.14)"
											: "rgba(255, 255, 255, 0.95)"
									: "transparent",
								border: "1px solid",
								borderColor: isActive
									? (theme) => hasNonDefaultStatus
										? statusTone.softBorderColor
										: theme.palette.mode === "dark"
											? "rgba(107, 130, 245, 0.5)"
											: "rgba(79, 107, 237, 0.45)"
									: (theme) => theme.palette.mode === "dark"
										? "rgba(255, 255, 255, 0.15)"
										: "rgba(15, 23, 42, 0.18)",
								color: isActive
									? hasNonDefaultStatus ? statusTone.color : "primary.main"
									: "text.secondary",
								fontWeight: isActive ? 600 : 400,
								transform: isActive ? "translateY(-1px)" : "none",
								boxShadow: isActive
									? (theme) => hasNonDefaultStatus
										? [
												`0 2px 12px ${statusTone.softBorderColor}`,
												theme.palette.mode === "dark" ? "0 4px 16px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.10)",
											].join(", ")
										: theme.palette.mode === "dark"
											? "0 2px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(107,130,245,0.35)"
											: "0 2px 8px rgba(0,0,0,0.12), 0 0 0 1px rgba(79,107,237,0.25)"
									: "none",
								transition: "all 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
								"&:hover": {
									background: isActive
										? undefined
										: (theme) => theme.palette.mode === "dark"
											? "rgba(255,255,255,0.05)"
											: "rgba(0,0,0,0.04)",
									borderColor: hasNonDefaultStatus
										? statusTone.softBorderColor
										: (theme) => theme.palette.mode === "dark"
											? "rgba(107,130,245,0.38)"
											: "rgba(79,107,237,0.3)",
									transform: "translateY(-1px)",
									color: isActive ? undefined : "text.primary",
								},
								/* Top-edge accent stripe for active tab */
								"&::after": isActive
									? {
											content: "\"\"",
											position: "absolute",
											top: -1,
											left: "20%",
											right: "20%",
											height: "2px",
											borderRadius: "0 0 3px 3px",
											background: hasNonDefaultStatus
												? statusTone.color
												: "linear-gradient(90deg, #4f6bed, #7c3aed)",
											boxShadow: hasNonDefaultStatus
												? `0 0 8px ${statusTone.softBorderColor}`
												: "0 0 8px rgba(107,130,245,0.5)",
										}
									: {},
							}}
							label={
								<Stack
									direction="row"
									spacing={0.75}
									data-testid={`window-tab-content-${window.id}`}
									sx={{ alignItems: "center", minWidth: 0, maxWidth: "100%" }}
								>
									<Box
										component="span"
										className="window-tab-index"
										sx={{
											display: "inline-flex",
											alignItems: "center",
											justifyContent: "center",
											width: 17,
											height: 17,
											minWidth: 17,
											flex: "0 0 17px",
											fontSize: "var(--font-size-2xs)",
											fontWeight: 700,
											lineHeight: 1,
											borderRadius: "50%",
											background: isActive
												? hasNonDefaultStatus
													? statusTone.color
													: "linear-gradient(135deg, #4f6bed, #7c3aed)"
												: undefined,
											backgroundColor: isActive ? undefined : "action.disabledBackground",
											color: isActive ? "#fff" : "text.disabled",
											border: isActive ? "none" : "1px solid",
											borderColor: isActive ? "transparent" : "divider",
											boxShadow: isActive && !hasNonDefaultStatus
												? "0 0 6px rgba(107,130,245,0.45)"
												: "none",
											transition: "all 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
										}}
									>
										{window.index}
									</Box>
									{appConfig && AppIcon && (
										<Box
											component="span"
											className={`window-tab-app-icon app-${appName ?? "unknown"}`}
											data-testid={`window-tab-app-icon-${window.id}`}
											aria-label={appConfig.label}
											title={appConfig.label}
											sx={{
												display: "inline-flex",
												alignItems: "center",
												justifyContent: "center",
												width: 20,
												height: 20,
												borderRadius: "6px",
												color: appConfig.color,
												backgroundColor: isActive ? appConfig.backgroundColor : "transparent",
												flex: "0 0 20px",
												opacity: isActive ? 1 : 0.65,
												transition: "all 180ms ease",
											}}
										>
											<AppIcon sx={{ fontSize: "var(--font-size-sm)" }} />
										</Box>
									)}
									<Typography
										component="span"
										className="window-tab-name"
										variant="body2"
										sx={{
											fontSize: "var(--font-size-xs)",
											fontWeight: isActive ? 600 : 400,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
											minWidth: 0,
											flex: "1 1 auto",
											letterSpacing: "-0.01em",
										}}
									>
										{displayName}
									</Typography>
									{hasAttentionBadge && (
										<Box
											component="span"
											className={`attention-badge${isAttention && !isAttentionExplicit ? " is-soft" : ""}`}
											sx={{
												display: "inline-flex",
												alignItems: "center",
												justifyContent: "center",
												minWidth: 16,
												height: 16,
												padding: "0 4px",
												borderRadius: "var(--radius-full)",
												fontSize: "var(--font-size-2xs)",
												fontWeight: 700,
												lineHeight: 1,
												color: "#fff",
												backgroundColor: isAttentionExplicit ? "var(--color-attention-explicit)" : "var(--color-attention)",
												animation: isAttentionExplicit ? `${pulseAnimation} 2s infinite` : "none",
												flexShrink: 0,
												boxShadow: isAttentionExplicit
													? "0 0 6px rgba(220,38,38,0.5)"
													: "0 0 6px rgba(217,119,6,0.4)",
											}}
										>
											{window.attentionCount}
										</Box>
									)}
								</Stack>
							}
						/>
					);
				})}
			</Tabs>
		</Box>
	);
}

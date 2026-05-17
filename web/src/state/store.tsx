import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { AppConfig, ConnectionConfig, ConnectionHealth, SessionInfoData, WindowInfo, PaneInfo } from "../api/client.js";

export interface WindowSummary {
	id: string;
	name: string;
	index: number;
	active: boolean;
	paneCount: number;
	activePaneID: string;
	activePaneTitle: string;
	attentionState?: "none" | "attention" | "explicit";
	attentionCount?: number;
	intelligenceApp?: string;
	intelligenceStatus?: string;
	intelligenceSummary?: string;
	intelligenceSource?: string;
	intelligenceConfidence?: number;
	intelligenceStale?: boolean;
	intelligenceUpdatedAt?: string;
	intelligenceError?: string;
	intelligenceAppCounts?: Record<string, number>;
}

export interface PaneData {
	id: string;
	title: string;
	index: number;
	active: boolean;
	width: number;
	height: number;
	left: number;
	top: number;
	attentionState?: "none" | "attention" | "explicit";
	intelligenceApp?: string;
	intelligenceStatus?: string;
	intelligenceSummary?: string;
	intelligenceSource?: string;
	intelligenceConfidence?: number;
	intelligenceStale?: boolean;
	intelligenceUpdatedAt?: string;
	intelligenceError?: string;
}

export interface SessionWindowState {
	windows: WindowSummary[];
	loadedPanes: Record<string, PaneData[]>;
	panesLoaded: boolean;
}

/**
 * Stable ID selectors: window holds a `@window_id`, pane holds a `%pane_id`.
 * These are populated once a session is opened and remain stable across refreshes.
 */
export interface SelectedPane {
	connectionId: string;
	session: string;
	window?: string;
	pane?: string;
}

function windowInfoToSummary(w: WindowInfo): WindowSummary {
	return {
		id: w.ID,
		name: w.Name,
		index: w.Index,
		active: w.Active,
		paneCount: w.PaneCount,
		activePaneID: w.ActivePaneID,
		activePaneTitle: w.ActivePaneTitle,
		attentionState: w.AttentionState,
		attentionCount: w.AttentionCount,
		intelligenceApp: w.IntelligenceApp,
		intelligenceStatus: w.IntelligenceStatus,
		intelligenceSummary: w.IntelligenceSummary,
		intelligenceSource: w.IntelligenceSource,
		intelligenceConfidence: w.IntelligenceConfidence,
		intelligenceStale: w.IntelligenceStale,
		intelligenceUpdatedAt: w.IntelligenceUpdatedAt,
		intelligenceError: w.IntelligenceError,
		intelligenceAppCounts: w.IntelligenceAppCounts,
	};
}

function paneInfoToData(p: PaneInfo): PaneData {
	return {
		id: p.ID,
		title: p.Title,
		index: p.Index,
		active: p.Active,
		width: p.Width,
		height: p.Height,
		left: p.Left,
		top: p.Top,
		attentionState: p.AttentionState,
		intelligenceApp: p.IntelligenceApp,
		intelligenceStatus: p.IntelligenceStatus,
		intelligenceSummary: p.IntelligenceSummary,
		intelligenceSource: p.IntelligenceSource,
		intelligenceConfidence: p.IntelligenceConfidence,
		intelligenceStale: p.IntelligenceStale,
		intelligenceUpdatedAt: p.IntelligenceUpdatedAt,
		intelligenceError: p.IntelligenceError,
	};
}

export interface UISettings {
	theme: string;
	windowTheme: string;
	fontSize: number;
	terminalFontSize: number;
	terminalFontWeight: string;
}

export interface AppState {
	connections: ConnectionConfig[];
	selectedConnectionId: string | null;
	sessions: Record<string, SessionInfoData[]>;
	windows: Record<string, SessionWindowState>;
	loading: {
		connections: boolean;
		sessions: boolean;
		creatingConnection: boolean;
		connectionHealth: boolean;
	};
	error: { code: string; message: string } | null;
	showNewConnectionForm: boolean;
	showSettingsPanel: boolean;
	configConflict: ConfigConflictState | null;
	confirmDialog: ConfirmDialogState | null;
	selectedPane: SelectedPane | null;
	connectionHealth: Record<string, ConnectionHealth>;
	editingConnection: ConnectionConfig | null;
	uiSettings: UISettings;
}

export interface ConfigConflictState {
	pendingConfig: AppConfig;
	onReload: () => Promise<void>;
	onRetry: () => Promise<void>;
}

export interface ConfirmDialogState {
	title: string;
	message: string;
	confirmText: string;
	confirmVariant: "danger" | "primary";
	onConfirm: () => void;
}

interface AppContextValue extends AppState {
	setConnections: (connections: ConnectionConfig[]) => void;
	setSelectedConnectionId: (id: string | null) => void;
	setSessions: (connectionId: string, sessions: SessionInfoData[]) => void;
	updateSession: (connectionId: string, sessionName: string, updates: Partial<SessionInfoData>) => void;
	setWindows: (connectionId: string, session: string, windows: WindowInfo[]) => void;
	setPanes: (connectionId: string, session: string, windowId: string, panes: PaneInfo[]) => void;
	setLoading: (key: keyof AppState["loading"], value: boolean) => void;
	setError: (error: { code: string; message: string } | null) => void;
	setShowNewConnectionForm: (show: boolean) => void;
	setShowSettingsPanel: (show: boolean) => void;
	setConfigConflict: (conflict: ConfigConflictState | null) => void;
	setConfirmDialog: (dialog: ConfirmDialogState | null) => void;
	showConfirm: (options: Omit<ConfirmDialogState, "onConfirm"> & { onConfirm: () => void }) => void;
	setSelectedPane: (pane: SelectedPane | null) => void;
	setConnectionHealth: (health: Record<string, ConnectionHealth>) => void;
	setEditingConnection: (connection: ConnectionConfig | null) => void;
	setUISettings: (settings: UISettings) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
	const [connections, setConnectionsState] = useState<ConnectionConfig[]>([]);
	const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
	const [sessions, setSessionsState] = useState<Record<string, SessionInfoData[]>>({});
	const [windows, setWindowsState] = useState<AppState["windows"]>({});
	const [loading, setLoadingState] = useState<AppState["loading"]>({
		connections: false,
		sessions: false,
		creatingConnection: false,
		connectionHealth: false,
	});
	const [error, setErrorState] = useState<AppState["error"]>(null);
	const [showNewConnectionForm, setShowNewConnectionForm] = useState(false);
	const [showSettingsPanel, setShowSettingsPanel] = useState(false);
	const [configConflict, setConfigConflict] = useState<ConfigConflictState | null>(null);
	const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
	const [selectedPane, setSelectedPane] = useState<SelectedPane | null>(null);
	const [connectionHealth, setConnectionHealth] = useState<Record<string, ConnectionHealth>>({});
	const [editingConnection, setEditingConnection] = useState<ConnectionConfig | null>(null);
	const [uiSettings, setUISettingsState] = useState<UISettings>({
		theme: "dark",
		windowTheme: "dark",
		fontSize: 16,
		terminalFontSize: 14,
		terminalFontWeight: "normal",
	});

	const setConnections = useCallback((newConnections: ConnectionConfig[]) => {
		setConnectionsState(newConnections);
	}, []);

	const setSessions = useCallback((connectionId: string, newSessions: SessionInfoData[]) => {
		setSessionsState((prev) => ({ ...prev, [connectionId]: newSessions }));
	}, []);

	const updateSession = useCallback((connectionId: string, sessionName: string, updates: Partial<SessionInfoData>) => {
		setSessionsState((prev) => ({
			...prev,
			[connectionId]: (prev[connectionId] ?? []).map((s) =>
				s.name === sessionName ? { ...s, ...updates } : s
			),
		}));
	}, []);

	const setWindows = useCallback((connectionId: string, session: string, newWindows: WindowInfo[]) => {
		const key = `${connectionId}:${session}`;
		setWindowsState((prev) => {
			const existing = prev[key];
			return {
				...prev,
				[key]: {
					windows: newWindows.map(windowInfoToSummary),
					loadedPanes: existing?.loadedPanes ?? {},
					panesLoaded: existing?.panesLoaded ?? false,
				},
			};
		});
	}, []);

	const setPanes = useCallback((connectionId: string, session: string, windowId: string, newPanes: PaneInfo[]) => {
		const key = `${connectionId}:${session}`;
		setWindowsState((prev) => {
			const existing = prev[key];
			return {
				...prev,
				[key]: {
					windows: existing?.windows ?? [],
					loadedPanes: {
						...(existing?.loadedPanes ?? {}),
						[windowId]: newPanes.map(paneInfoToData),
					},
					panesLoaded: true,
				},
			};
		});
	}, []);

	const setLoading = useCallback((key: keyof AppState["loading"], value: boolean) => {
		setLoadingState((prev) => ({ ...prev, [key]: value }));
	}, []);

	const setError = useCallback((err: { code: string; message: string } | null) => {
		setErrorState(err);
	}, []);

	const showConfirm = useCallback((options: Omit<ConfirmDialogState, "onConfirm"> & { onConfirm: () => void }) => {
		setConfirmDialog({
			title: options.title,
			message: options.message,
			confirmText: options.confirmText,
			confirmVariant: options.confirmVariant,
			onConfirm: options.onConfirm,
		});
	}, []);

	const setUISettings = useCallback((settings: UISettings) => {
		setUISettingsState(settings);
	}, []);

	const value: AppContextValue = {
		connections,
		selectedConnectionId,
		sessions,
		windows,
		loading,
		error,
		showNewConnectionForm,
		showSettingsPanel,
		configConflict,
		confirmDialog,
		selectedPane,
		connectionHealth,
		editingConnection,
		setConnections,
		setSelectedConnectionId,
		setSessions,
		updateSession,
		setWindows,
		setPanes,
		setLoading,
		setError,
		setShowNewConnectionForm,
		setShowSettingsPanel,
		setConfigConflict,
		setConfirmDialog,
		showConfirm,
		setSelectedPane,
		setConnectionHealth,
		setEditingConnection,
		uiSettings,
		setUISettings,
	};

	return (
		<AppContext.Provider value={value}>
			{children}
		</AppContext.Provider>
	);
}

export function useAppState(): AppContextValue {
	const context = useContext(AppContext);
	if (!context) {
		throw new Error("useAppState must be used within an AppProvider");
	}
	return context;
}

export function useSelectedConnection(): ConnectionConfig | null {
	const { connections, selectedConnectionId } = useAppState();
	return connections.find((c) => c.id === selectedConnectionId) ?? null;
}

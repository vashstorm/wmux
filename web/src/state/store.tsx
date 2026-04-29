import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { AppConfig, ConnectionConfig, ConnectionHealth } from "../api/client.js";

export interface SelectedPane {
	connectionId: string;
	session: string;
	window: string;
	pane: string;
}

export interface AppState {
	connections: ConnectionConfig[];
	selectedConnectionId: string | null;
	sessions: Record<string, string[]>;
	windows: Record<string, { id: string; name: string; panes: { id: string; index: number }[] }[]>;
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
	setSessions: (connectionId: string, sessions: string[]) => void;
	setWindows: (connectionId: string, session: string, windows: { id: string; name: string; panes: { id: string; index: number }[] }[]) => void;
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
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
	const [connections, setConnectionsState] = useState<ConnectionConfig[]>([]);
	const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
	const [sessions, setSessionsState] = useState<Record<string, string[]>>({});
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

	const setConnections = useCallback((newConnections: ConnectionConfig[]) => {
		setConnectionsState(newConnections);
	}, []);

	const setSessions = useCallback((connectionId: string, newSessions: string[]) => {
		setSessionsState((prev) => ({ ...prev, [connectionId]: newSessions }));
	}, []);

	const setWindows = useCallback((connectionId: string, session: string, newWindows: { id: string; name: string; panes: { id: string; index: number }[] }[]) => {
		setWindowsState((prev) => ({
			...prev,
			[`${connectionId}:${session}`]: newWindows,
		}));
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
		setWindows,
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

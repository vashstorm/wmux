import { ApiError, type ApiErrorResponse } from "./errors.js";
import { getAuthToken, getBaseUrl } from "./runtime.js";

async function apiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
	const url = `${getBaseUrl()}${path}`;
	const headers = new Headers(options.headers);

	headers.set("Content-Type", "application/json");

	const token = getAuthToken();
	if (token) {
		headers.set("Authorization", `Bearer ${token}`);
	}

	const response = await fetch(url, {
		...options,
		headers,
	});

	if (!response.ok) {
		let code = "internal_error";
		let message = `HTTP ${response.status}`;
		try {
			const errorData = (await response.json()) as ApiErrorResponse;
			code = errorData.error?.code ?? code;
			message = errorData.error?.message ?? message;
		} catch {
			message = response.statusText || message;
		}
		throw new ApiError(code, message, response.status);
	}

	if (response.status === 204) {
		return null;
	}

	return response.json();
}

export interface ConnectionConfig {
	id: string;
	type: string;
	host?: string;
	port?: number;
	user?: string;
	privateKeyPath?: string;
	knownHostsPath?: string;
}

export function connectionDisplayName(conn: ConnectionConfig): string {
	if (conn.type === "local") {
		return "local";
	}
	return conn.host ?? conn.id;
}

export interface ConnectionsListResponse {
	data: ConnectionConfig[];
}

export interface SessionInfo {
	ID?: string;
	Name?: string;
	Attached?: boolean;
	id?: string;
	name?: string;
	attached?: boolean;
}

export interface SessionInfoData {
	id?: string;
	name?: string;
	attached?: boolean;
	windowCount?: number;
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

export interface SessionsListResponse {
	connectionId: string;
	mode: string;
	adapterPath?: string;
	data: SessionInfoData[];
}

export interface OperationResponse {
	connectionId: string;
	session?: string;
	window?: string;
	pane?: string;
	operation: string;
	mode: string;
	adapterPath?: string;
	status: string;
}

export interface HealthResponse {
	status: string;
}

export interface IntelligenceProviderConfig {
	name: string;
	provider: string;
	model: string;
	apiKey?: string;
	baseURL?: string;
	apiKeyConfigured?: boolean;
}

export interface IntelligenceConfig {
	enabled: boolean;
	activeProvider?: string;
	providers: IntelligenceProviderConfig[];
	maxBytes: number;
	timeoutSec: number;
	minSessionIntervalSec: number;
	maxConcurrency: number;
	cacheTTLSec: number;
}

export interface AppConfig {
	schemaVersion: number;
	server: {
		bind: string;
	};
	auth: {
		token: string;
		tokenConfigured?: boolean;
	};
	tmux: {
		path: string;
	};
	connections: ConnectionConfig[];
	ui: {
		theme: string;
		windowTheme: string;
		fontSize: number;
		terminalFontSize: number;
		terminalFontWeight: string;
	};
	intelligence: IntelligenceConfig;
	logs?: {
		level: string;
		path: string;
	};
}

export async function fetchHealth(): Promise<HealthResponse> {
	return (await apiFetch("/api/health")) as HealthResponse;
}

export async function listConnections(): Promise<ConnectionConfig[]> {
	const response = (await apiFetch("/api/connections")) as ConnectionsListResponse;
	return response.data ?? [];
}

export async function createConnection(data: Omit<ConnectionConfig, "id">): Promise<ConnectionConfig> {
	return (await apiFetch("/api/connections", {
		method: "POST",
		body: JSON.stringify(data),
	})) as ConnectionConfig;
}

export async function getConnection(id: string): Promise<ConnectionConfig> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(id)}`)) as ConnectionConfig;
}

export async function updateConnection(id: string, data: ConnectionConfig): Promise<ConnectionConfig> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(id)}`, {
		method: "PUT",
		body: JSON.stringify(data),
	})) as ConnectionConfig;
}

export async function deleteConnection(id: string): Promise<void> {
	await apiFetch(`/api/connections/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}

export interface WindowInfo {
	ID: string;
	Name: string;
	Index: number;
	Active: boolean;
	PaneCount: number;
	ActivePaneID: string;
	ActivePaneTitle: string;
	AttentionState?: "none" | "attention" | "explicit";
	AttentionCount?: number;
	IntelligenceApp?: string;
	IntelligenceStatus?: string;
	IntelligenceSummary?: string;
	IntelligenceSource?: string;
	IntelligenceConfidence?: number;
	IntelligenceStale?: boolean;
	IntelligenceUpdatedAt?: string;
	IntelligenceError?: string;
	IntelligenceAppCounts?: Record<string, number>;
}

type RawWindowInfo = Partial<WindowInfo> & {
	id?: string;
	name?: string;
	index?: number;
	active?: boolean;
	paneCount?: number;
	activePaneId?: string;
	activePaneTitle?: string;
	attentionState?: "none" | "attention" | "explicit";
	attentionCount?: number;
};

export interface WindowsListResponse {
	connectionId: string;
	session: string;
	mode: string;
	adapterPath?: string;
	data: WindowInfo[];
}

export interface PaneInfo {
	ID: string;
	Title: string;
	Index: number;
	Active: boolean;
	Width: number;
	Height: number;
	Left: number;
	Top: number;
	AttentionState?: "none" | "attention" | "explicit";
	IntelligenceApp?: string;
	IntelligenceStatus?: string;
	IntelligenceSummary?: string;
	IntelligenceSource?: string;
	IntelligenceConfidence?: number;
	IntelligenceStale?: boolean;
	IntelligenceUpdatedAt?: string;
	IntelligenceError?: string;
}

type RawPaneInfo = Partial<PaneInfo> & {
	id?: string;
	title?: string;
	index?: number;
	active?: boolean;
	width?: number;
	height?: number;
	left?: number;
	top?: number;
	attentionState?: "none" | "attention" | "explicit";
};

export interface PanesListResponse {
	connectionId: string;
	session: string;
	window: string;
	mode: string;
	adapterPath?: string;
	data: PaneInfo[];
}

function normalizeWindowInfo(window: RawWindowInfo): WindowInfo {
	return {
		ID: window.ID ?? window.id ?? "",
		Name: window.Name ?? window.name ?? "",
		Index: window.Index ?? window.index ?? 0,
		Active: window.Active ?? window.active ?? false,
		PaneCount: window.PaneCount ?? window.paneCount ?? 0,
		ActivePaneID: window.ActivePaneID ?? window.activePaneId ?? "",
		ActivePaneTitle: window.ActivePaneTitle ?? window.activePaneTitle ?? "",
		AttentionState: window.AttentionState ?? window.attentionState,
		AttentionCount: window.AttentionCount ?? window.attentionCount,
	};
}

function normalizePaneInfo(pane: RawPaneInfo): PaneInfo {
	return {
		ID: pane.ID ?? pane.id ?? "",
		Title: pane.Title ?? pane.title ?? "",
		Index: pane.Index ?? pane.index ?? 0,
		Active: pane.Active ?? pane.active ?? false,
		Width: pane.Width ?? pane.width ?? 0,
		Height: pane.Height ?? pane.height ?? 0,
		Left: pane.Left ?? pane.left ?? 0,
		Top: pane.Top ?? pane.top ?? 0,
		AttentionState: pane.AttentionState ?? pane.attentionState,
	};
}

export async function listWindows(connectionId: string, sessionName: string): Promise<WindowsListResponse> {
	const response = (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions/${encodeURIComponent(sessionName)}/windows`)) as Omit<WindowsListResponse, "data"> & { data?: RawWindowInfo[] };
	return {
		...response,
		data: (response.data ?? []).map(normalizeWindowInfo),
	};
}

export async function listPanes(connectionId: string, sessionName: string, windowId: string): Promise<PanesListResponse> {
	const response = (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions/${encodeURIComponent(sessionName)}/windows/${encodeURIComponent(windowId)}/panes`)) as Omit<PanesListResponse, "data"> & { data?: RawPaneInfo[] };
	return {
		...response,
		data: (response.data ?? []).map(normalizePaneInfo),
	};
}

type NormalizedSession = {
	id: string;
	name: string;
	attached: boolean;
	windowCount: number;
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
};

export async function listSessions(connectionId: string): Promise<SessionsListResponse> {
	const response = (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions`)) as {
		connectionId: string;
		mode: string;
		adapterPath?: string;
		data: Array<{
			ID?: string;
			Name?: string;
			Attached?: boolean;
			WindowCount?: number;
			id?: string;
			name?: string;
			attached?: boolean;
			windowCount?: number;
			AttentionState?: "none" | "attention" | "explicit";
			attentionState?: "none" | "attention" | "explicit";
			AttentionCount?: number;
			attentionCount?: number;
			IntelligenceApp?: string;
			intelligenceApp?: string;
			IntelligenceStatus?: string;
			intelligenceStatus?: string;
			IntelligenceSummary?: string;
			intelligenceSummary?: string;
			IntelligenceSource?: string;
			intelligenceSource?: string;
			IntelligenceConfidence?: number;
			intelligenceConfidence?: number;
			IntelligenceStale?: boolean;
			intelligenceStale?: boolean;
			IntelligenceUpdatedAt?: string;
			intelligenceUpdatedAt?: string;
			IntelligenceError?: string;
			intelligenceError?: string;
			IntelligenceAppCounts?: Record<string, number>;
			intelligenceAppCounts?: Record<string, number>;
		}>;
	};
	return {
		...response,
		data: (response.data ?? [])
			.map((s): NormalizedSession => {
				if (typeof s === "string") {
					return { id: "", name: s, attached: false, windowCount: 0 };
				}
				return {
					id: s.id ?? s.ID ?? "",
					name: s.name ?? s.Name ?? "",
					attached: s.attached ?? s.Attached ?? false,
					windowCount: s.windowCount ?? s.WindowCount ?? 0,
					attentionState: s.attentionState ?? s.AttentionState,
					attentionCount: s.attentionCount ?? s.AttentionCount,
					intelligenceApp: s.intelligenceApp ?? s.IntelligenceApp,
					intelligenceStatus: s.intelligenceStatus ?? s.IntelligenceStatus,
					intelligenceSummary: s.intelligenceSummary ?? s.IntelligenceSummary,
					intelligenceSource: s.intelligenceSource ?? s.IntelligenceSource,
					intelligenceConfidence: s.intelligenceConfidence ?? s.IntelligenceConfidence,
					intelligenceStale: s.intelligenceStale ?? s.IntelligenceStale,
					intelligenceUpdatedAt: s.intelligenceUpdatedAt ?? s.IntelligenceUpdatedAt,
					intelligenceError: s.intelligenceError ?? s.IntelligenceError,
					intelligenceAppCounts: s.intelligenceAppCounts ?? s.IntelligenceAppCounts,
				};
			})
			.filter((s) => s.name.length > 0),
	};
}

export async function createSession(connectionId: string, name: string): Promise<OperationResponse> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions`, {
		method: "POST",
		body: JSON.stringify({ name }),
	})) as OperationResponse;
}

export async function killSession(connectionId: string, session: string): Promise<OperationResponse> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions/${encodeURIComponent(session)}`, {
		method: "DELETE",
	})) as OperationResponse;
}

export async function renameSession(connectionId: string, session: string, newName: string): Promise<OperationResponse> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions/${encodeURIComponent(session)}`, {
		method: "PATCH",
		body: JSON.stringify({ name: newName }),
	})) as OperationResponse;
}

export async function createWindow(connectionId: string, session: string, name: string): Promise<OperationResponse> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions/${encodeURIComponent(session)}/windows`, {
		method: "POST",
		body: JSON.stringify({ name }),
	})) as OperationResponse;
}

export async function killWindow(connectionId: string, session: string, window: string): Promise<OperationResponse> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions/${encodeURIComponent(session)}/windows/${encodeURIComponent(window)}`, {
		method: "DELETE",
	})) as OperationResponse;
}

export async function splitPane(
	connectionId: string,
	session: string,
	window: string,
	pane: string,
	horizontal: boolean,
): Promise<OperationResponse> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions/${encodeURIComponent(session)}/windows/${encodeURIComponent(window)}/panes/${encodeURIComponent(pane)}/split`, {
		method: "POST",
		body: JSON.stringify({ horizontal }),
	})) as OperationResponse;
}

export async function killPane(
	connectionId: string,
	session: string,
	window: string,
	pane: string,
): Promise<OperationResponse> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions/${encodeURIComponent(session)}/windows/${encodeURIComponent(window)}/panes/${encodeURIComponent(pane)}`, {
		method: "DELETE",
	})) as OperationResponse;
}

export interface ConnectionHealth {
	connectionId: string;
	status: "online" | "offline";
	checkedAt: string;
	errorCode?: string;
	message?: string;
}

export interface ConnectionHealthListResponse {
	data: ConnectionHealth[];
}

export async function listConnectionHealth(): Promise<ConnectionHealth[]> {
	const response = (await apiFetch("/api/connections/health")) as ConnectionHealthListResponse;
	return response.data ?? [];
}

export async function getConnectionHealth(id: string): Promise<ConnectionHealth> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(id)}/health`)) as ConnectionHealth;
}

export async function getConfig(): Promise<AppConfig> {
	return (await apiFetch("/api/config")) as AppConfig;
}

export async function updateConfig(data: AppConfig): Promise<AppConfig> {
	return (await apiFetch("/api/config", {
		method: "PUT",
		body: JSON.stringify(data),
	})) as AppConfig;
}

export interface SessionIntelligence {
	app: string;
	status: string;
	summary: string;
	source: string;
	confidence: number;
	stale: boolean;
	updatedAt: string;
	error?: string;
}

export interface AnalyzeSessionResponse {
	connectionId: string;
	session: string;
	status: string;
	updated: number;
	skipped: number;
	errors: number;
	intelligence?: SessionIntelligence & { appCounts?: Record<string, number> };
}

export async function analyzeSession(connectionId: string, session: string): Promise<AnalyzeSessionResponse> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions/${encodeURIComponent(session)}/analyze`, {
		method: "POST",
		body: JSON.stringify({}),
	})) as AnalyzeSessionResponse;
}

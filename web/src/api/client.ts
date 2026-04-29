import { ApiError, type ApiErrorResponse } from "./errors.js";

const BASE_URL = "";

function getAuthToken(): string | null {
	return sessionStorage.getItem("wmux-auth-token");
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
	const url = `${BASE_URL}${path}`;
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
		fontSize: number;
		terminalFontSize: number;
		terminalFontWeight: string;
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
}

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
}

export interface PanesListResponse {
	connectionId: string;
	session: string;
	window: string;
	mode: string;
	adapterPath?: string;
	data: PaneInfo[];
}

export async function listWindows(connectionId: string, sessionName: string): Promise<WindowsListResponse> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions/${encodeURIComponent(sessionName)}/windows`)) as WindowsListResponse;
}

export async function listPanes(connectionId: string, sessionName: string, windowId: string): Promise<PanesListResponse> {
	return (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions/${encodeURIComponent(sessionName)}/windows/${encodeURIComponent(windowId)}/panes`)) as PanesListResponse;
}

type NormalizedSession = { id: string; name: string; attached: boolean; windowCount: number; attentionState?: "none" | "attention" | "explicit"; attentionCount?: number };

export async function listSessions(connectionId: string): Promise<SessionsListResponse> {
	const response = (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions`)) as {
		connectionId: string;
		mode: string;
		adapterPath?: string;
		data: Array<{ ID?: string; Name?: string; Attached?: boolean; WindowCount?: number; id?: string; name?: string; attached?: boolean; windowCount?: number; AttentionState?: "none" | "attention" | "explicit"; attentionState?: "none" | "attention" | "explicit"; AttentionCount?: number; attentionCount?: number }>;
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

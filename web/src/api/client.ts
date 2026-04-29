import { ApiError, type ApiErrorResponse } from "./errors.js";

const BASE_URL = "";

function getAuthToken(): string | null {
	return sessionStorage.getItem("webmux-auth-token");
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
	name: string;
	type: string;
	host?: string;
	port?: number;
	user?: string;
	privateKeyPath?: string;
	knownHostsPath?: string;
}

export interface ConnectionsListResponse {
	data: ConnectionConfig[];
}

export interface SessionsListResponse {
	connectionId: string;
	mode: string;
	adapterPath?: string;
	data: string[];
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

export async function listSessions(connectionId: string): Promise<SessionsListResponse> {
	const response = (await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}/sessions`)) as SessionsListResponse;
	return {
		...response,
		data: response.data ?? [],
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

export async function getConfig(): Promise<AppConfig> {
	return (await apiFetch("/api/config")) as AppConfig;
}

export async function updateConfig(data: AppConfig): Promise<AppConfig> {
	return (await apiFetch("/api/config", {
		method: "PUT",
		body: JSON.stringify(data),
	})) as AppConfig;
}

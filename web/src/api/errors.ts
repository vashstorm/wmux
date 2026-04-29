/** API error types */
export interface ApiErrorDetail {
	code: string;
	message: string;
}

export interface ApiErrorResponse {
	error: ApiErrorDetail;
}

export class ApiError extends Error {
	code: string;
	status: number;

	constructor(code: string, message: string, status: number) {
		super(message);
		this.code = code;
		this.status = status;
		this.name = "ApiError";
	}
}

/** Map API error codes to user-friendly English messages */
const ERROR_MESSAGES: Record<string, string> = {
	unauthorized: "Authentication required",
	ssh_key_unreadable: "SSH private key not found or unreadable",
	ssh_unknown_host: "Unknown SSH host - add it to known_hosts first",
	tmux_not_found: "tmux is not installed or not in PATH",
	conflict: "Configuration was modified externally",
	not_found: "Resource not found",
	bad_request: "Invalid request",
	internal_error: "Internal server error",
};

export function getErrorMessage(code: string, fallbackMessage?: string): string {
	return ERROR_MESSAGES[code] ?? fallbackMessage ?? `Error: ${code}`;
}

import { useState } from "react";
import { createConnection } from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";
import { useAppState } from "../state/store.js";

export function NewConnectionForm() {
	const { showNewConnectionForm, setShowNewConnectionForm, setConnections, connections, setLoading, setError } = useAppState();
	const [name, setName] = useState("");
	const [type, setType] = useState<"local" | "ssh">("local");
	const [host, setHost] = useState("");
	const [port, setPort] = useState("");
	const [user, setUser] = useState("");
	const [privateKeyPath, setPrivateKeyPath] = useState("");

	if (!showNewConnectionForm) return null;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading("creatingConnection", true);
		setError(null);

		try {
			const payload: { name: string; type: string; host?: string; port?: number; user?: string; privateKeyPath?: string } = {
				name: name.trim(),
				type,
			};

			if (type === "ssh") {
				if (host.trim()) payload.host = host.trim();
				if (port.trim()) payload.port = Number.parseInt(port.trim(), 10);
				if (user.trim()) payload.user = user.trim();
				if (privateKeyPath.trim()) payload.privateKeyPath = privateKeyPath.trim();
			}

			const newConnection = await createConnection(payload);
			setConnections([...connections, newConnection]);
			setShowNewConnectionForm(false);
			setName("");
			setType("local");
			setHost("");
			setPort("");
			setUser("");
			setPrivateKeyPath("");
		} catch (err) {
			if (err instanceof Error && "code" in err) {
				const apiErr = err as { code: string; message: string };
				setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
			} else {
				setError({ code: "unknown_error", message: err instanceof Error ? err.message : "Unknown error" });
			}
		} finally {
			setLoading("creatingConnection", false);
		}
	};

	return (
		<div className="new-connection-form-overlay">
			<form className="new-connection-form" onSubmit={handleSubmit} data-testid="new-connection-form">
				<h3 className="form-title">New Connection</h3>

				<div className="form-field">
					<label htmlFor="conn-name">Name *</label>
					<input
						id="conn-name"
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="My Server"
						required
						data-testid="connection-name-input"
					/>
				</div>

				<div className="form-field">
					<label htmlFor="conn-type">Type</label>
					<select
						id="conn-type"
						value={type}
						onChange={(e) => setType(e.target.value as "local" | "ssh")}
						data-testid="connection-type-select"
					>
						<option value="local">Local</option>
						<option value="ssh">SSH</option>
					</select>
				</div>

				{type === "ssh" && (
					<>
						<div className="form-field">
							<label htmlFor="conn-host">Host *</label>
							<input
								id="conn-host"
								type="text"
								value={host}
								onChange={(e) => setHost(e.target.value)}
								placeholder="example.com"
								required={type === "ssh"}
								data-testid="connection-host-input"
							/>
						</div>

						<div className="form-field">
							<label htmlFor="conn-port">Port</label>
							<input
								id="conn-port"
								type="number"
								value={port}
								onChange={(e) => setPort(e.target.value)}
								placeholder="22"
								data-testid="connection-port-input"
							/>
						</div>

						<div className="form-field">
							<label htmlFor="conn-user">User *</label>
							<input
								id="conn-user"
								type="text"
								value={user}
								onChange={(e) => setUser(e.target.value)}
								placeholder="root"
								required={type === "ssh"}
								data-testid="connection-user-input"
							/>
						</div>

						<div className="form-field">
							<label htmlFor="conn-key">Private Key Path</label>
							<input
								id="conn-key"
								type="text"
								value={privateKeyPath}
								onChange={(e) => setPrivateKeyPath(e.target.value)}
								placeholder="~/.ssh/id_rsa"
								data-testid="connection-key-input"
							/>
						</div>
					</>
				)}

				<div className="form-actions">
					<button
						type="button"
						className="form-button form-button-secondary"
						onClick={() => setShowNewConnectionForm(false)}
						data-testid="cancel-connection"
					>
						Cancel
					</button>
					<button
						type="submit"
						className="form-button form-button-primary"
						data-testid="save-connection"
						disabled={!name.trim()}
					>
						Save
					</button>
				</div>
			</form>
		</div>
	);
}

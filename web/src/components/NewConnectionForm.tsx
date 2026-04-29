import { useState, useEffect } from "react";
import { createConnection, updateConnection, listConnectionHealth, connectionDisplayName } from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";
import { useAppState } from "../state/store.js";

export function NewConnectionForm() {
	const {
		showNewConnectionForm,
		setShowNewConnectionForm,
		editingConnection,
		setEditingConnection,
		setConnections,
		connections,
		setLoading,
		setError,
		setConnectionHealth,
	} = useAppState();
	const [type, setType] = useState<"local" | "ssh">("local");
	const [host, setHost] = useState("");
	const [port, setPort] = useState("");
	const [user, setUser] = useState("");
	const [privateKeyPath, setPrivateKeyPath] = useState("");
	const [knownHostsPath, setKnownHostsPath] = useState("");

	const isEditMode = editingConnection !== null;

	useEffect(() => {
		if (editingConnection) {
			setType(editingConnection.type as "local" | "ssh");
			setHost(editingConnection.host ?? "");
			setPort(editingConnection.port ? String(editingConnection.port) : "");
			setUser(editingConnection.user ?? "");
			setPrivateKeyPath(editingConnection.privateKeyPath ?? "");
			setKnownHostsPath(editingConnection.knownHostsPath ?? "");
		} else {
			setType("local");
			setHost("");
			setPort("");
			setUser("");
			setPrivateKeyPath("");
			setKnownHostsPath("");
		}
	}, [editingConnection]);

	if (!showNewConnectionForm && !editingConnection) return null;

	const handleClose = () => {
		setShowNewConnectionForm(false);
		setEditingConnection(null);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading("creatingConnection", true);
		setError(null);

		try {
			const payload: {
				type: string;
				host?: string;
				port?: number;
				user?: string;
				privateKeyPath?: string;
				knownHostsPath?: string;
			} = {
				type,
			};

			if (type === "ssh") {
				if (host.trim()) payload.host = host.trim();
				if (port.trim()) payload.port = Number.parseInt(port.trim(), 10);
				if (user.trim()) payload.user = user.trim();
				if (privateKeyPath.trim()) payload.privateKeyPath = privateKeyPath.trim();
				if (knownHostsPath.trim()) payload.knownHostsPath = knownHostsPath.trim();
			}

			if (isEditMode) {
				const updated = await updateConnection(editingConnection.id, {
					...editingConnection,
					...payload,
					id: editingConnection.id,
				});
				setConnections(connections.map((c) => (c.id === editingConnection.id ? updated : c)));
			} else {
				const newConnection = await createConnection(payload);
				setConnections([...connections, newConnection]);
			}

			handleClose();

			try {
				const healthData = await listConnectionHealth();
				const healthMap: Record<string, { connectionId: string; status: "online" | "offline"; checkedAt: string; errorCode?: string; message?: string }> = {};
				for (const h of healthData) {
					healthMap[h.connectionId] = h;
				}
				setConnectionHealth(healthMap);
			} catch {
				// non-critical
			}
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

	const computedName = type === "local" ? "local" : (host.trim() || "ssh");

	return (
		<div className="new-connection-form-overlay" onClick={handleClose}>
			<form className="new-connection-form" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} data-testid="new-connection-form">
				<h3 className="form-title">{isEditMode ? "Edit Connection" : "New Connection"}</h3>

				<div className="form-field">
					<label>Connection</label>
					<div className="computed-name-display" data-testid="computed-connection-name">{computedName}</div>
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

						<div className="form-field">
							<label htmlFor="conn-known-hosts">Known Hosts Path</label>
							<input
								id="conn-known-hosts"
								type="text"
								value={knownHostsPath}
								onChange={(e) => setKnownHostsPath(e.target.value)}
								placeholder="~/.ssh/known_hosts"
								data-testid="connection-known-hosts-input"
							/>
						</div>
					</>
				)}

				<div className="form-actions">
					<button
						type="button"
						className="form-button form-button-secondary"
						onClick={handleClose}
						data-testid="cancel-connection"
					>
						Cancel
					</button>
					<button
						type="submit"
						className="form-button form-button-primary"
						data-testid="save-connection"
						disabled={type === "ssh" && (!host.trim() || !user.trim())}
					>
						{isEditMode ? "Update" : "Save"}
					</button>
				</div>
			</form>
		</div>
	);
}

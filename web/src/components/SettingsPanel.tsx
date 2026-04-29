import { useEffect, useMemo, useState } from "react";
import { getConfig, type AppConfig, updateConfig, deleteConnection, listConnectionHealth, connectionDisplayName } from "../api/client.js";
import { ApiError, getErrorMessage } from "../api/errors.js";
import { useAppState } from "../state/store.js";
import { applyUIFontSize, clampUIFontSize, clampTerminalFontSize } from "../ui/fontSize.js";

interface SettingsFormState {
	bind: string;
	tmuxPath: string;
	knownHostsPath: string;
	theme: string;
	tokenInput: string;
	tokenConfigured: boolean;
	fontSize: number;
	terminalFontSize: number;
}

function buildFormState(config: AppConfig): SettingsFormState {
	const sshConnection = config.connections.find((connection) => connection.type === "ssh");
	return {
		bind: config.server.bind,
		tmuxPath: config.tmux.path,
		knownHostsPath: sshConnection?.knownHostsPath ?? "~/.ssh/known_hosts",
		theme: config.ui.theme,
		tokenInput: "",
		tokenConfigured: Boolean(config.auth.tokenConfigured),
		fontSize: config.ui.fontSize || 16,
		terminalFontSize: config.ui.terminalFontSize || 14,
	};
}

export function SettingsPanel() {
	const {
		showSettingsPanel,
		setShowSettingsPanel,
		setError,
		connections,
		setConnections,
		setConfigConflict,
		configConflict,
		setShowNewConnectionForm,
		setEditingConnection,
		showConfirm,
		connectionHealth,
		setConnectionHealth,
		setUISettings,
	} = useAppState();
	const [config, setConfig] = useState<AppConfig | null>(null);
	const [formState, setFormState] = useState<SettingsFormState | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	const knownHostsPlaceholder = useMemo(() => "~/.ssh/known_hosts", []);

	const loadConfig = async () => {
		setIsLoading(true);
		try {
			const response = await getConfig();
			setConfig(response);
			setFormState(buildFormState(response));
			setConnections(response.connections);
			setConfigConflict(null);
		} catch (err) {
			if (err instanceof ApiError) {
				setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
			}
		} finally {
			setIsLoading(false);
		}
	};

	const loadHealth = async () => {
		try {
			const healthData = await listConnectionHealth();
			const healthMap: Record<string, { connectionId: string; status: "online" | "offline"; checkedAt: string; errorCode?: string; message?: string }> = {};
			for (const h of healthData) {
				healthMap[h.connectionId] = h;
			}
			setConnectionHealth(healthMap);
		} catch {
			// ignored
		}
	};

	useEffect(() => {
		if (!showSettingsPanel) {
			return;
		}
		void loadConfig();
		void loadHealth();
	}, [showSettingsPanel]);

	useEffect(() => {
		if (!formState) {
			return;
		}
		document.documentElement.dataset.theme = formState.theme;
		applyUIFontSize(formState.fontSize);
		setUISettings({
			theme: formState.theme,
			fontSize: formState.fontSize,
			terminalFontSize: formState.terminalFontSize,
		});
	}, [formState, setUISettings]);

	if (!showSettingsPanel) {
		return null;
	}

	const closePanel = () => {
		setShowSettingsPanel(false);
		setConfigConflict(null);
	};

	const updateField = <K extends keyof SettingsFormState>(key: K, value: SettingsFormState[K]) => {
		setFormState((current) => (current ? { ...current, [key]: value } : current));
	};

	const buildPayload = (): AppConfig | null => {
		if (!config || !formState) {
			return null;
		}

		const nextConnections = connections.map((connection) =>
			connection.type === "ssh"
				? {
					...connection,
					knownHostsPath: formState.knownHostsPath.trim() || knownHostsPlaceholder,
				}
				: connection,
		);

		return {
			...config,
			server: {
				...config.server,
				bind: formState.bind.trim(),
			},
			auth: {
				token: formState.tokenInput,
			},
			tmux: {
				...config.tmux,
				path: formState.tmuxPath.trim(),
			},
			connections: nextConnections,
			ui: {
				...config.ui,
				theme: formState.theme,
				fontSize: formState.fontSize,
				terminalFontSize: formState.terminalFontSize,
			},
		};
	};

	const performSave = async (payload: AppConfig) => {
		setIsSaving(true);
		try {
			const saved = await updateConfig(payload);
			setConfig(saved);
			setFormState(buildFormState(saved));
			setConnections(saved.connections);
								document.documentElement.dataset.theme = saved.ui.theme;
								applyUIFontSize(saved.ui.fontSize);
								setUISettings({
									theme: saved.ui.theme,
									fontSize: saved.ui.fontSize,
									terminalFontSize: saved.ui.terminalFontSize,
								});
								setConfigConflict(null);
								setShowSettingsPanel(false);
		} catch (err: unknown) {
			if (err instanceof ApiError && err.code === "conflict") {
				setConfigConflict({
					pendingConfig: payload,
					onReload: async () => {
						await loadConfig();
					},
					onRetry: async () => {
						const latest = await getConfig();
						const retryPayload: AppConfig = {
							...latest,
							server: { ...latest.server, bind: payload.server.bind },
							auth: { token: payload.auth.token },
							tmux: { ...latest.tmux, path: payload.tmux.path },
							ui: { ...latest.ui, theme: payload.ui.theme, fontSize: payload.ui.fontSize, terminalFontSize: payload.ui.terminalFontSize },
							connections: latest.connections.map((connection) => {
								if (connection.type !== "ssh") {
									return connection;
								}
								const pendingConnection = payload.connections.find((item) => item.id === connection.id);
								return {
									...connection,
									knownHostsPath: pendingConnection?.knownHostsPath ?? connection.knownHostsPath,
								};
							}),
						};
						await performSave(retryPayload);
					},
				});
				setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
				return;
			}

			if (err instanceof ApiError) {
				setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
			}
		} finally {
			setIsSaving(false);
		}
	};

	const handleSave = async (event: React.FormEvent) => {
		event.preventDefault();
		const payload = buildPayload();
		if (!payload) {
			return;
		}
		await performSave(payload);
	};

	const handleCancel = () => {
		if (config) {
			setFormState(buildFormState(config));
			document.documentElement.dataset.theme = config.ui.theme;
			applyUIFontSize(config.ui.fontSize);
			setUISettings({
				theme: config.ui.theme,
				fontSize: config.ui.fontSize,
				terminalFontSize: config.ui.terminalFontSize,
			});
		}
		closePanel();
	};

	const handleDeleteConnection = (connection: { id: string; type: string; host?: string }) => {
		showConfirm({
			title: "Delete Connection",
			message: `Delete connection "${connectionDisplayName(connection)}"? This cannot be undone.`,
			confirmText: "Delete Connection",
			confirmVariant: "danger",
			onConfirm: async () => {
				try {
					await deleteConnection(connection.id);
					const updated = connections.filter((c) => c.id !== connection.id);
					setConnections(updated);
					setConfig((prev) => prev ? { ...prev, connections: updated } : prev);
				} catch (err) {
					if (err instanceof Error && "code" in err) {
						const apiErr = err as { code: string; message: string };
						setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
					}
				}
			},
		});
	};

	const handleEditConnection = (connection: { id: string; type: string; host?: string }) => {
		setEditingConnection(connection);
	};

	const handleNewConnection = () => {
		setEditingConnection(null);
		setShowNewConnectionForm(true);
	};

	return (
		<div className="settings-panel-overlay">
			<div className="settings-panel" data-testid="settings-panel">
				<div className="settings-panel-header">
					<h3 className="form-title">Settings</h3>
					<button type="button" className="error-banner-dismiss" onClick={closePanel} aria-label="Close settings">
						×
					</button>
				</div>

				{isLoading || !formState ? (
					<div className="settings-panel-loading">Loading settings...</div>
				) : (
					<div className="settings-panel-body">
						{/* Left: Connections */}
						<div className="settings-connections-pane">
							<div className="settings-connections-pane-header">
								<span className="sidebar-section-label">Connections</span>
								<button
									type="button"
									className="sidebar-section-action"
									onClick={handleNewConnection}
									title="New Connection"
								>
									+
								</button>
							</div>
							{connections.length === 0 ? (
								<p className="settings-connections-empty">No connections configured</p>
							) : (
								<ul className="settings-connections-list">
									{connections.map((connection) => {
										const connHealth = connectionHealth[connection.id];
										const statusClass =
											connHealth?.status === "online"
												? "is-online"
												: connHealth?.status === "offline"
													? "is-offline"
													: "is-unknown";
										const typeLabel = connection.type === "ssh" ? "SSH" : "Local";
										const subtitle = connection.type === "ssh" && connection.host
											? `${connection.user ?? ""}@${connection.host}${connection.port ? `:${connection.port}` : ""}`
											: null;

										return (
											<li key={connection.id} className="settings-connection-item">
												<div className="settings-connection-info">
													<span
														className={`connection-status-dot ${statusClass}`}
														title={
															connHealth?.status === "online"
																? "Online"
																: connHealth?.status === "offline"
																	? `Offline: ${connHealth.errorCode ?? connHealth.message ?? "unknown"}`
																	: "Unknown"
														}
														aria-label={`Connection status: ${connHealth?.status ?? "unknown"}`}
													/>
													<div className="settings-connection-details">
														<span className="settings-connection-name">{connectionDisplayName(connection)}</span>
														<span className="settings-connection-meta">
															{typeLabel}
															{subtitle ? ` · ${subtitle}` : ""}
														</span>
													</div>
												</div>
												<div className="settings-connection-actions">
													<button
														type="button"
														className="connection-edit-btn"
														onClick={() => handleEditConnection(connection)}
														title="Edit connection"
														aria-label="Edit connection"
														data-testid={`settings-edit-connection-${connection.id}`}
													>
														✎
													</button>
													<button
														type="button"
														className="connection-delete-btn"
														onClick={() => handleDeleteConnection(connection)}
														title="Delete connection"
														aria-label="Delete connection"
														data-testid={`settings-delete-connection-${connection.id}`}
													>
														×
													</button>
												</div>
											</li>
										);
									})}
								</ul>
							)}
						</div>

						{/* Right: Settings form */}
						<form className="settings-form-pane" onSubmit={handleSave}>
							<div className="settings-divider-vertical" />

							<div className="settings-form-fields">
								<div className="form-field">
									<label htmlFor="settings-bind">Server Bind</label>
									<input
										id="settings-bind"
										type="text"
										value={formState.bind}
										onChange={(event) => updateField("bind", event.target.value)}
										data-testid="settings-bind-input"
									/>
								</div>

								<div className="form-field">
									<label htmlFor="settings-token">Auth Token</label>
									<input
										id="settings-token"
										type="password"
										value={formState.tokenInput}
										onChange={(event) => updateField("tokenInput", event.target.value)}
										placeholder={formState.tokenConfigured ? "Token already configured" : "Optional on localhost"}
										data-testid="settings-token-input"
										autoComplete="new-password"
									/>
									<p className="form-help-text" data-testid="settings-token-status">
										{formState.tokenConfigured ? "A token is configured. Enter a new value to replace it." : "No token configured yet."}
									</p>
								</div>

								<div className="form-field">
									<label htmlFor="settings-tmux-path">tmux Path</label>
									<input
										id="settings-tmux-path"
										type="text"
										value={formState.tmuxPath}
										onChange={(event) => updateField("tmuxPath", event.target.value)}
										data-testid="settings-tmux-path-input"
									/>
								</div>

								<div className="form-field">
									<label htmlFor="settings-known-hosts">known_hosts Path</label>
									<input
										id="settings-known-hosts"
										type="text"
										value={formState.knownHostsPath}
										onChange={(event) => updateField("knownHostsPath", event.target.value)}
										data-testid="settings-known-hosts-input"
									/>
								</div>

							<div className="form-field">
								<label htmlFor="settings-theme">Theme</label>
								<select
									id="settings-theme"
									value={formState.theme}
									onChange={(event) => updateField("theme", event.target.value)}
									data-testid="settings-theme-toggle"
								>
									<option value="dark">Dark</option>
									<option value="light">Light</option>
								</select>
							</div>

							<div className="form-field">
								<label htmlFor="settings-font-size">UI Font Size</label>
								<div className="font-size-control">
									<input
										id="settings-font-size"
										type="range"
										min={12}
										max={24}
										value={formState.fontSize}
										onChange={(event) => updateField("fontSize", clampUIFontSize(Number(event.target.value)))}
										data-testid="settings-font-size-input"
									/>
									<span className="font-size-value">{formState.fontSize}px</span>
								</div>
							</div>

							<div className="form-field">
								<label htmlFor="settings-terminal-font-size">Terminal Font Size</label>
								<div className="font-size-control">
									<input
										id="settings-terminal-font-size"
										type="range"
										min={8}
										max={32}
										value={formState.terminalFontSize}
										onChange={(event) => updateField("terminalFontSize", clampTerminalFontSize(Number(event.target.value)))}
										data-testid="settings-terminal-font-size-input"
									/>
									<span className="font-size-value">{formState.terminalFontSize}px</span>
								</div>
							</div>

							{connections.some((connection) => connection.type === "ssh") ? (
									<p className="form-help-text">Known hosts path applies to saved SSH connections.</p>
								) : null}

								<div className="form-actions">
									<button type="button" className="form-button form-button-secondary" onClick={handleCancel}>
										Cancel
									</button>
									<button type="submit" className="form-button form-button-primary" disabled={isSaving || isLoading}>
										{isSaving ? "Saving..." : "Save"}
									</button>
								</div>
							</div>
						</form>
					</div>
				)}
			</div>
		</div>
	);
}

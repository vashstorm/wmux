import { useEffect, useMemo, useState, useRef } from "react";
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
	const [activeTab, setActiveTab] = useState<"general" | "connections" | "appearance">("general");
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (scrollContainerRef.current) {
			scrollContainerRef.current.scrollTop = 0;
		}
	}, [activeTab]);

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
					<div className="settings-panel-header-title">
						<h3 className="form-title">Settings</h3>
						<span className="settings-panel-subtitle">Configure your wmux workspace</span>
					</div>
					<button type="button" className="error-banner-dismiss" onClick={closePanel} aria-label="Close settings">
						×
					</button>
				</div>

				{isLoading || !formState ? (
					<div className="settings-panel-loading">
						<div className="spinner" />
						<span>Loading settings...</span>
					</div>
				) : (
					<div className="settings-panel-body">
						{/* Left: Sidebar Navigation */}
						<aside className="settings-sidebar">
							<nav className="settings-nav">
								<button
									type="button"
									className={`settings-nav-item ${activeTab === "general" ? "is-active" : ""}`}
									onClick={() => setActiveTab("general")}
								>
									<span className="nav-icon">⚙</span>
									<span className="nav-label">General</span>
								</button>
								<button
									type="button"
									className={`settings-nav-item ${activeTab === "connections" ? "is-active" : ""}`}
									onClick={() => setActiveTab("connections")}
								>
									<span className="nav-icon">🌐</span>
									<span className="nav-label">Connections</span>
								</button>
								<button
									type="button"
									className={`settings-nav-item ${activeTab === "appearance" ? "is-active" : ""}`}
									onClick={() => setActiveTab("appearance")}
								>
									<span className="nav-icon">🎨</span>
									<span className="nav-label">Appearance</span>
								</button>
							</nav>

							<div className="settings-sidebar-footer">
								<div className="version-info">wmux v{window.performance ? "0.1.0" : "dev"}</div>
							</div>
						</aside>

						{/* Right: Content Area */}
						<div className="settings-main">
							<form className="settings-form" onSubmit={handleSave}>
								<div className="settings-content-scroll" ref={scrollContainerRef}>
									{activeTab === "general" && (
										<div className="settings-tab-content">
											<div className="settings-form-section">
												<h4 className="settings-section-title">Server Configuration</h4>
												<div className="form-field">
													<label htmlFor="settings-bind">Server Bind</label>
													<input
														id="settings-bind"
														type="text"
														value={formState.bind}
														onChange={(event) => updateField("bind", event.target.value)}
														data-testid="settings-bind-input"
														placeholder="127.0.0.1:7331"
													/>
													<p className="form-help-text">IP address and port the server listens on.</p>
												</div>

												<div className="form-field">
													<label htmlFor="settings-tmux-path">tmux Path</label>
													<input
														id="settings-tmux-path"
														type="text"
														value={formState.tmuxPath}
														onChange={(event) => updateField("tmuxPath", event.target.value)}
														data-testid="settings-tmux-path-input"
														placeholder="tmux"
													/>
													<p className="form-help-text">Path to the tmux executable on the server.</p>
												</div>
											</div>

											<div className="settings-form-section">
												<h4 className="settings-section-title">Security & Auth</h4>
												<div className="form-field">
													<label htmlFor="settings-token">Auth Token</label>
													<div className="password-input-wrapper">
														<input
															id="settings-token"
															type="password"
															value={formState.tokenInput}
															onChange={(event) => updateField("tokenInput", event.target.value)}
															placeholder={formState.tokenConfigured ? "••••••••••••••••" : "Optional on localhost"}
															data-testid="settings-token-input"
															autoComplete="new-password"
														/>
													</div>
													<p className="form-help-text" data-testid="settings-token-status">
														{formState.tokenConfigured ? "A token is configured. Enter a new value to replace it." : "No token configured yet."}
													</p>
												</div>
											</div>

											<div className="settings-form-section">
												<h4 className="settings-section-title">SSH Environment</h4>
												<div className="form-field">
													<label htmlFor="settings-known-hosts">known_hosts Path</label>
													<input
														id="settings-known-hosts"
														type="text"
														value={formState.knownHostsPath}
														onChange={(event) => updateField("knownHostsPath", event.target.value)}
														data-testid="settings-known-hosts-input"
														placeholder="~/.ssh/known_hosts"
													/>
													<p className="form-help-text">Default path for host key verification.</p>
												</div>
											</div>
										</div>
									)}

									{activeTab === "connections" && (
										<div className="settings-tab-content">
											<div className="settings-connections-header">
												<div className="settings-section-title">Managed Connections</div>
												<button
													type="button"
													className="settings-new-connection-btn"
													onClick={handleNewConnection}
												>
													+ NEW
												</button>
											</div>
											
											{connections.length === 0 ? (
												<div className="settings-connections-empty">
													<div className="empty-icon">🔌</div>
													<p>No connections configured yet</p>
													<button type="button" className="settings-new-connection-btn" onClick={handleNewConnection}>
														+ NEW
													</button>
												</div>
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
															: "System Terminal";

														return (
															<li key={connection.id} className="settings-connection-item">
																<div className="settings-connection-info">
																	<div
																		className={`connection-status-dot ${statusClass}`}
																		title={
																			connHealth?.status === "online"
																				? "Online"
																				: connHealth?.status === "offline"
																					? `Offline: ${connHealth.errorCode ?? connHealth.message ?? "unknown"}`
																					: "Unknown"
																		}
																	/>
																	<div className="settings-connection-details">
																		<span className="settings-connection-name">{connectionDisplayName(connection)}</span>
																		<span className="settings-connection-meta">
																			{typeLabel} · {subtitle}
																		</span>
																	</div>
																</div>
																<div className="settings-connection-actions">
																	<button
																		type="button"
																		className="connection-edit-btn"
																		onClick={() => handleEditConnection(connection)}
																		title="Edit connection"
																	>
																		✎
																	</button>
																	<button
																		type="button"
																		className="connection-delete-btn"
																		onClick={() => handleDeleteConnection(connection)}
																		title="Delete connection"
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
									)}

									{activeTab === "appearance" && (
										<div className="settings-tab-content">
											<div className="settings-form-section">
												<h4 className="settings-section-title">Theme & Layout</h4>
												<div className="form-field">
													<label htmlFor="settings-theme">Color Theme</label>
													<div className="theme-grid">
														<button
															type="button"
															className={`theme-card dark ${formState.theme === "dark" ? "is-active" : ""}`}
															onClick={() => updateField("theme", "dark")}
														>
															<div className="theme-preview" />
															<span>Dark Tech</span>
														</button>
														<button
															type="button"
															className={`theme-card light ${formState.theme === "light" ? "is-active" : ""}`}
															onClick={() => updateField("theme", "light")}
														>
															<div className="theme-preview" />
															<span>Classic Light</span>
														</button>
													</div>
												</div>
											</div>

											<div className="settings-form-section">
												<h4 className="settings-section-title">Typography</h4>
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
											</div>
										</div>
									)}
								</div>

								<div className="settings-footer">
									<div className="settings-footer-status">
										{isSaving && <span className="saving-indicator">Saving changes...</span>}
									</div>
									<div className="form-actions">
										<button type="button" className="btn btn-secondary" onClick={handleCancel}>
											CANCEL
										</button>
										<button type="submit" className="btn btn-primary" disabled={isSaving || isLoading}>
											{isSaving ? "SAVING..." : "SAVE"}
										</button>
									</div>
								</div>
							</form>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

import { useEffect, useMemo, useState, useRef } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Select, MenuItem, FormControl, InputLabel, Typography, Box, Paper, IconButton } from "@mui/material";
import { getConfig, type AppConfig, type IntelligenceProviderConfig, updateConfig, deleteConnection, listConnectionHealth, connectionDisplayName } from "../api/client.js";
import { ApiError, getErrorMessage } from "../api/errors.js";
import { useAppState } from "../state/store.js";
import { applyUIFontSize, clampUIFontSize, clampTerminalFontSize, normalizeTerminalFontWeight, VALID_TERMINAL_FONT_WEIGHTS } from "../ui/fontSize.js";
import { THEME_OPTIONS, normalizeThemeId } from "../ui/themes.js";

const THEME_LABELS: Record<string, string> = {
	light: "Light",
	dark: "Dark",
};

interface ProviderFormState extends IntelligenceProviderConfig {
	isNew: boolean;
	apiKeyInput: string;
	originalName: string;
}

interface SettingsFormState {
	bind: string;
	tmuxPath: string;
	knownHostsPath: string;
	theme: string;
	windowTheme: string;
	tokenInput: string;
	tokenConfigured: boolean;
	fontSize: number;
	terminalFontSize: number;
	terminalFontWeight: string;
	intelligenceEnabled: boolean;
	intelligenceActiveProvider: string;
	intelligenceProviders: IntelligenceProviderConfig[];
	intelligenceMaxBytes: number;
	intelligenceTimeoutSec: number;
	intelligenceMinSessionIntervalSec: number;
	intelligenceMaxConcurrency: number;
	intelligenceCacheTTLSec: number;
	editingProvider: ProviderFormState | null;
}

function buildFormState(config: AppConfig): SettingsFormState {
	const sshConnection = config.connections.find((connection) => connection.type === "ssh");
	const intel = config.intelligence;
	return {
		bind: config.server.bind,
		tmuxPath: config.tmux.path,
		knownHostsPath: sshConnection?.knownHostsPath ?? "~/.ssh/known_hosts",
		theme: normalizeThemeId(config.ui.theme),
		windowTheme: normalizeThemeId(config.ui.windowTheme, normalizeThemeId(config.ui.theme)),
		tokenInput: "",
		tokenConfigured: Boolean(config.auth.tokenConfigured),
		fontSize: config.ui.fontSize || 16,
		terminalFontSize: config.ui.terminalFontSize || 14,
		terminalFontWeight: normalizeTerminalFontWeight(config.ui.terminalFontWeight),
		intelligenceEnabled: intel?.enabled ?? false,
		intelligenceActiveProvider: intel?.activeProvider ?? "",
		intelligenceProviders: intel?.providers ?? [],
		intelligenceMaxBytes: intel?.maxBytes ?? 4096,
		intelligenceTimeoutSec: intel?.timeoutSec ?? 30,
		intelligenceMinSessionIntervalSec: intel?.minSessionIntervalSec ?? 60,
		intelligenceMaxConcurrency: intel?.maxConcurrency ?? 3,
		intelligenceCacheTTLSec: intel?.cacheTTLSec ?? 300,
		editingProvider: null,
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
	const [activeTab, setActiveTab] = useState<"general" | "connections" | "theme" | "typography" | "intelligence">("general");
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (scrollContainerRef.current) {
			scrollContainerRef.current.scrollTop = 0;
		}
	}, [activeTab]);

	const knownHostsPlaceholder = useMemo(() => "~/.ssh/known_hosts", []);
	const renderThemeCard = (field: "theme" | "windowTheme", value: string, themeId: string) => {
		const theme = THEME_OPTIONS.find((option) => option.id === themeId);
		if (!theme) {
			return null;
		}

		const label = THEME_LABELS[themeId] ?? themeId;

		return (
			<button
				key={`${field}-${theme.id}`}
				type="button"
				className={`theme-card ${value === theme.id ? "is-active" : ""}`}
				onClick={() => updateField(field, theme.id)}
			>
				<span>{label}</span>
			</button>
		);
	};

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
			windowTheme: formState.windowTheme,
			fontSize: formState.fontSize,
			terminalFontSize: formState.terminalFontSize,
			terminalFontWeight: formState.terminalFontWeight,
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

		const providers = formState.intelligenceProviders.map((p) => {
			const result: IntelligenceProviderConfig = {
				name: p.name,
				provider: p.provider,
				model: p.model,
				baseURL: p.baseURL,
			};
			if (p.apiKey) {
				result.apiKey = p.apiKey;
			}
			return result;
		});

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
				windowTheme: formState.windowTheme,
				fontSize: formState.fontSize,
				terminalFontSize: formState.terminalFontSize,
				terminalFontWeight: formState.terminalFontWeight,
			},
			intelligence: {
				enabled: formState.intelligenceEnabled,
				activeProvider: formState.intelligenceActiveProvider || undefined,
				providers,
				maxBytes: formState.intelligenceMaxBytes,
				timeoutSec: formState.intelligenceTimeoutSec,
				minSessionIntervalSec: formState.intelligenceMinSessionIntervalSec,
				maxConcurrency: formState.intelligenceMaxConcurrency,
				cacheTTLSec: formState.intelligenceCacheTTLSec,
			},
		};
	};

	const performSave = async (payload: AppConfig) => {
		setIsSaving(true);
		try {
			const saved = await updateConfig(payload);
			const savedTheme = normalizeThemeId(saved.ui.theme);
			const savedWindowTheme = normalizeThemeId(saved.ui.windowTheme, savedTheme);
			setConfig(saved);
			setFormState(buildFormState(saved));
			setConnections(saved.connections);
			document.documentElement.dataset.theme = savedTheme;
			applyUIFontSize(saved.ui.fontSize);
			setUISettings({
				theme: savedTheme,
				windowTheme: savedWindowTheme,
				fontSize: saved.ui.fontSize,
				terminalFontSize: saved.ui.terminalFontSize,
				terminalFontWeight: saved.ui.terminalFontWeight,
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
							ui: { ...latest.ui, theme: payload.ui.theme, windowTheme: payload.ui.windowTheme, fontSize: payload.ui.fontSize, terminalFontSize: payload.ui.terminalFontSize, terminalFontWeight: payload.ui.terminalFontWeight },
							intelligence: {
								...latest.intelligence,
								enabled: payload.intelligence.enabled,
								activeProvider: payload.intelligence.activeProvider,
								providers: payload.intelligence.providers,
								maxBytes: payload.intelligence.maxBytes,
								timeoutSec: payload.intelligence.timeoutSec,
								minSessionIntervalSec: payload.intelligence.minSessionIntervalSec,
								maxConcurrency: payload.intelligence.maxConcurrency,
								cacheTTLSec: payload.intelligence.cacheTTLSec,
							},
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
		if (!payload || !formState) {
			return;
		}

		if (formState.intelligenceEnabled) {
			if (formState.intelligenceProviders.length === 0) {
				setError({ code: "bad_request", message: "At least one provider is required when intelligence is enabled" });
				return;
			}
			if (!formState.intelligenceActiveProvider.trim()) {
				setError({ code: "bad_request", message: "An active provider must be selected when intelligence is enabled" });
				return;
			}
			const activeExists = formState.intelligenceProviders.some(
				(p) => p.name === formState.intelligenceActiveProvider
			);
			if (!activeExists) {
				setError({ code: "bad_request", message: "Selected active provider does not exist" });
				return;
			}
			const names = new Set<string>();
			for (const provider of formState.intelligenceProviders) {
				if (!provider.name.trim()) {
					setError({ code: "bad_request", message: "All providers must have a name" });
					return;
				}
				if (!provider.provider.trim()) {
					setError({ code: "bad_request", message: "All providers must have a provider type" });
					return;
				}
				if (!provider.model.trim()) {
					setError({ code: "bad_request", message: "All providers must have a model" });
					return;
				}
				if (names.has(provider.name)) {
					setError({ code: "bad_request", message: `Provider name "${provider.name}" must be unique` });
					return;
				}
				names.add(provider.name);
			}
		}

		await performSave(payload);
	};

	const handleCancel = () => {
		if (config) {
			const theme = normalizeThemeId(config.ui.theme);
			const windowTheme = normalizeThemeId(config.ui.windowTheme, theme);
			setFormState(buildFormState(config));
			document.documentElement.dataset.theme = theme;
			applyUIFontSize(config.ui.fontSize);
			setUISettings({
				theme,
				windowTheme,
				fontSize: config.ui.fontSize,
				terminalFontSize: config.ui.terminalFontSize,
				terminalFontWeight: config.ui.terminalFontWeight,
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

	const navItems: { key: typeof activeTab; icon: string; label: string }[] = [
		{ key: "general", icon: "🔧", label: "General" },
		{ key: "connections", icon: "🌐", label: "Connections" },
		{ key: "theme", icon: "🎨", label: "Theme" },
		{ key: "typography", icon: "🔠", label: "Typography" },
		{ key: "intelligence", icon: "✨", label: "AI" },
	];

	return (
		<Dialog
			open={showSettingsPanel}
			onClose={handleCancel}
			maxWidth="xl"
			fullWidth
			fullScreen
			data-testid="settings-panel"
		>
			<DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 3 }}>
				<Box>
					<Typography variant="h6" component="h3">Settings</Typography>
					<Typography variant="body2" color="text.secondary">Configure your wmux workspace</Typography>
				</Box>
				<IconButton
					onClick={closePanel}
					aria-label="Close settings"
					sx={{ color: "text.secondary" }}
				>
					×
				</IconButton>
			</DialogTitle>

			{isLoading || !formState ? (
				<DialogContent>
					<Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "200px", gap: 2 }}>
						<div className="spinner" />
						<span>Loading settings...</span>
					</Box>
				</DialogContent>
			) : (
				<Box sx={{ display: "flex", height: "calc(100vh - 130px)", overflow: "hidden" }}>
					{/* Left: Sidebar Navigation */}
									<Box role="complementary" sx={{ width: 200, borderRight: 1, borderColor: "divider", p: 1, display: "flex", flexDirection: "column" }}>
						<nav>
							{navItems.map((item) => (
								<Button
									key={item.key}
									type="button"
									fullWidth
									variant={activeTab === item.key ? "contained" : "text"}
									onClick={() => setActiveTab(item.key)}
									sx={{
										justifyContent: "flex-start",
										px: 2,
										py: 1,
										mb: 0.5,
										textTransform: "none",
										fontSize: "0.875rem",
									}}
								>
									<span className="nav-icon" style={{ marginRight: 8 }}>{item.icon}</span>
									<span className="nav-label">{item.label}</span>
								</Button>
							))}
						</nav>

						<Box sx={{ mt: "auto", p: 1 }}>
							<Typography variant="caption" color="text.secondary">wmux v{window.performance ? "0.1.0" : "dev"}</Typography>
						</Box>
					</Box>

					{/* Right: Content Area */}
					<Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
						<form className="settings-form" onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
							<Box sx={{ flex: 1, overflow: "auto", p: 3 }} ref={scrollContainerRef}>
								{activeTab === "general" && (
									<Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Server Configuration</Typography>
											<Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
												<TextField
													id="settings-bind"
													label="Server Bind"
													type="text"
													value={formState.bind}
													onChange={(event) => updateField("bind", event.target.value)}
													data-testid="settings-bind-input"
													placeholder="127.0.0.1:7331"
													fullWidth
													helperText="IP address and port to listen on."
												/>

												<TextField
													id="settings-tmux-path"
													label="tmux Path"
													type="text"
													value={formState.tmuxPath}
													onChange={(event) => updateField("tmuxPath", event.target.value)}
													data-testid="settings-tmux-path-input"
													placeholder="tmux"
													fullWidth
													helperText="Path to the tmux executable."
												/>
											</Box>
										</Box>

										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Security & Auth</Typography>
											<TextField
												id="settings-token"
												label="Auth Token"
												type="password"
												value={formState.tokenInput}
												onChange={(event) => updateField("tokenInput", event.target.value)}
												placeholder={formState.tokenConfigured ? "••••••••••••••••" : "Optional on localhost"}
												data-testid="settings-token-input"
												fullWidth
												autoComplete="new-password"
												className="password-input-wrapper"
											/>
											<Typography variant="caption" color="text.secondary" data-testid="settings-token-status" sx={{ display: "block", mt: 0.5 }}>
												{formState.tokenConfigured ? "A token is configured. Enter a new value to replace it." : "No token configured yet."}
											</Typography>
										</Box>

										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>SSH Environment</Typography>
											<TextField
												id="settings-known-hosts"
												label="known_hosts Path"
												type="text"
												value={formState.knownHostsPath}
												onChange={(event) => updateField("knownHostsPath", event.target.value)}
												data-testid="settings-known-hosts-input"
												placeholder="~/.ssh/known_hosts"
												fullWidth
												helperText="Default path for host key verification."
											/>
										</Box>
									</Box>
								)}

								{activeTab === "connections" && (
									<Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
										<Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
											<Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Managed Connections</Typography>
											<Button
												type="button"
												variant="contained"
												size="small"
												onClick={handleNewConnection}
											>
												+ NEW
											</Button>
										</Box>

										{connections.length === 0 ? (
											<Box sx={{ textAlign: "center", py: 4 }}>
												<div className="empty-icon" style={{ fontSize: "48px" }}>🔌</div>
												<Typography sx={{ my: 1 }}>No connections configured yet</Typography>
												<Button variant="contained" size="small" onClick={handleNewConnection}>+ NEW</Button>
											</Box>
										) : (
											<Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
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
														<Box key={connection.id} component="li" className="settings-connection-item" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", p: 2, mb: 1, borderRadius: 1, bgcolor: "background.paper", boxShadow: 1 }}>
															<Box className="settings-connection-info" sx={{ display: "flex", alignItems: "center", gap: 2 }}>
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
																<Box className="settings-connection-details">
																	<Typography className="settings-connection-name" variant="body2" sx={{ fontWeight: 500 }}>{connectionDisplayName(connection)}</Typography>
																	<Typography className="settings-connection-meta" variant="caption" color="text.secondary">
																		{typeLabel} · {subtitle}
																	</Typography>
																</Box>
															</Box>
															<Box className="settings-connection-actions" sx={{ display: "flex", gap: 0.5 }}>
																<IconButton
																	type="button"
																	className="connection-edit-btn"
																	onClick={() => handleEditConnection(connection)}
																	title="Edit connection"
																	size="small"
																>
																	✎
																</IconButton>
																<IconButton
																	type="button"
																	className="connection-delete-btn"
																	onClick={() => handleDeleteConnection(connection)}
																	title="Delete connection"
																	size="small"
																>
																	×
																</IconButton>
															</Box>
														</Box>
													);
												})}
											</Box>
										)}
									</Box>
								)}

								{activeTab === "intelligence" && (
									<Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>AI Intelligence</Typography>
											<div className="form-field form-field-toggle">
												<label htmlFor="intelligence-enabled">Enable AI Intelligence</label>
												<input
													id="intelligence-enabled"
													type="checkbox"
													checked={formState.intelligenceEnabled}
													onChange={(event) => updateField("intelligenceEnabled", event.target.checked)}
													data-testid="intelligence-enabled-checkbox"
												/>
											</div>
										</Box>

										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Providers</Typography>
											<Box sx={{ mb: 2 }}>
												<Button
													type="button"
													variant="contained"
													size="small"
													onClick={() => setFormState((current) =>
														current ? {
															...current,
															editingProvider: {
																name: "",
																provider: "anthropic",
																model: "",
																apiKey: "",
																baseURL: "",
																apiKeyConfigured: false,
																isNew: true,
																apiKeyInput: "",
																originalName: "",
															},
														} : current
													)}
													disabled={!formState.intelligenceEnabled}
													data-testid="intelligence-add-provider-btn"
												>
													+ ADD PROVIDER
												</Button>
											</Box>

											{formState.editingProvider && (
												<Box className="intelligence-provider-editor" data-testid="intelligence-provider-editor" sx={{ display: "flex", flexDirection: "column", gap: 2, p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}>
													<div className="form-field">
														<label htmlFor="provider-editor-name">Name</label>
														<input
															id="provider-editor-name"
															type="text"
															value={formState.editingProvider.name}
															onChange={(event) => setFormState((current) =>
																current && current.editingProvider
																	? {
																		...current,
																		editingProvider: { ...current.editingProvider, name: event.target.value },
																	}
																	: current
															)}
															data-testid="provider-editor-name-input"
															placeholder="my-anthropic"
														/>
													</div>
													<div className="form-field">
														<label htmlFor="provider-editor-type">Provider Type</label>
														<select
															id="provider-editor-type"
															value={formState.editingProvider.provider}
															onChange={(event) => setFormState((current) =>
																current && current.editingProvider
																	? {
																		...current,
																		editingProvider: { ...current.editingProvider, provider: event.target.value },
																	}
																	: current
															)}
															data-testid="provider-editor-type-select"
														>
															<option value="anthropic">anthropic</option>
															<option value="openai">openai</option>
														</select>
													</div>
													<div className="form-field">
														<label htmlFor="provider-editor-model">Model</label>
														<input
															id="provider-editor-model"
															type="text"
															value={formState.editingProvider.model}
															onChange={(event) => setFormState((current) =>
																current && current.editingProvider
																	? {
																		...current,
																		editingProvider: { ...current.editingProvider, model: event.target.value },
																	}
																	: current
															)}
															data-testid="provider-editor-model-input"
															placeholder="claude-sonnet-4-20250514"
														/>
													</div>
													<div className="form-field">
														<label htmlFor="provider-editor-api-key">API Key</label>
														<div className="password-input-wrapper">
															<input
																id="provider-editor-api-key"
																type="password"
																value={formState.editingProvider.apiKeyInput}
																onChange={(event) => setFormState((current) =>
																	current && current.editingProvider
																		? {
																			...current,
																			editingProvider: { ...current.editingProvider, apiKeyInput: event.target.value },
																		}
																		: current
																)}
																data-testid="provider-editor-api-key-input"
																placeholder={formState.editingProvider.apiKeyConfigured && !formState.editingProvider.isNew ? "•••••••••••••••• (leave blank to keep existing)" : "sk-..."}
																autoComplete="new-password"
															/>
														</div>
														<p className="form-help-text">
															{formState.editingProvider.apiKeyConfigured && !formState.editingProvider.isNew
																? "A key is configured. Enter a new value to replace it, or leave blank to keep existing."
																: "API key is required for new providers."}
														</p>
													</div>
													<div className="form-field">
														<label htmlFor="provider-editor-base-url">Base URL</label>
														<input
															id="provider-editor-base-url"
															type="text"
															value={formState.editingProvider.baseURL ?? ""}
															onChange={(event) => setFormState((current) =>
																current && current.editingProvider
																	? {
																		...current,
																		editingProvider: { ...current.editingProvider, baseURL: event.target.value },
																	}
																	: current
															)}
															data-testid="provider-editor-base-url-input"
															placeholder="https://api.openrouter.ai/v1"
														/>
														<p className="form-help-text">Optional custom endpoint for OpenAI-compatible providers.</p>
													</div>
													<Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
														<Button
															type="button"
															variant="outlined"
															onClick={() => setFormState((current) =>
																current ? { ...current, editingProvider: null } : current
															)}
														>
															CANCEL
														</Button>
														<Button
															type="button"
															variant="contained"
															onClick={() => {
																if (!formState) return;
																const editor = formState.editingProvider;
																if (!editor) return;
																if (!editor.name.trim()) {
																	setError({ code: "bad_request", message: "Provider name is required" });
																	return;
																}
																if (!editor.model.trim()) {
																	setError({ code: "bad_request", message: "Provider model is required" });
																	return;
																}
																if (editor.isNew && !editor.apiKeyInput.trim()) {
																	setError({ code: "bad_request", message: "API key is required for new providers" });
																	return;
																}
																const duplicateName = formState.intelligenceProviders.some(
																	(p) => p.name === editor.name.trim() && p.name !== (editor.isNew ? "" : editor.originalName)
																);
																const existingProvider = formState.editingProvider && !formState.editingProvider.isNew
																	? formState.intelligenceProviders.find((p) => p.name === editor.originalName)
																	: undefined;
																if (duplicateName && existingProvider?.name !== editor.name.trim()) {
																	setError({ code: "bad_request", message: `Provider name "${editor.name.trim()}" already exists` });
																	return;
																}

																const updatedProvider: IntelligenceProviderConfig = {
																	name: editor.name.trim(),
																	provider: editor.provider,
																	model: editor.model.trim(),
																	baseURL: editor.baseURL?.trim() || undefined,
																	apiKeyConfigured: editor.apiKeyConfigured || (editor.apiKeyInput.trim().length > 0),
																};
																if (editor.apiKeyInput.trim()) {
																	updatedProvider.apiKey = editor.apiKeyInput.trim();
																}

																setFormState((current) => {
																	if (!current || !current.editingProvider) return current;
																	const isNew = current.editingProvider.isNew;
																	const existingIndex = current.intelligenceProviders.findIndex(
																		(p) => p.name === (isNew ? current.editingProvider?.name : current.editingProvider?.originalName) && !isNew
																	);
																	let providers: IntelligenceProviderConfig[];
																	if (isNew) {
																		providers = [...current.intelligenceProviders, updatedProvider];
																	} else if (existingIndex >= 0) {
																		providers = [...current.intelligenceProviders];
																		providers[existingIndex] = updatedProvider;
																	} else {
																		providers = current.intelligenceProviders;
																	}
																	return {
																		...current,
																		intelligenceProviders: providers,
																		editingProvider: null,
																	};
																});
															}}
															data-testid="provider-editor-save-btn"
														>
															SAVE PROVIDER
														</Button>
													</Box>
												</Box>
											)}

											{formState.intelligenceProviders.length === 0 && !formState.editingProvider ? (
												<Box className="intelligence-providers-empty" data-testid="intelligence-providers-empty" sx={{ textAlign: "center", py: 4 }}>
													<div className="empty-icon" style={{ fontSize: "48px" }}>🤖</div>
													<Typography>No providers configured yet. Add a provider to get started.</Typography>
												</Box>
											) : (
												<Box component="ul" className="intelligence-providers-list" data-testid="intelligence-providers-list" sx={{ listStyle: "none", p: 0, m: 0, display: "flex", flexDirection: "column", gap: 2 }}>
													{formState.intelligenceProviders.map((provider) => {
														const isActive = provider.name === formState.intelligenceActiveProvider;
														return (
															<Box
																key={provider.name}
																component="li"
																className={`intelligence-provider-card ${isActive ? "is-active" : ""}`}
																data-testid={`intelligence-provider-card-${provider.name}`}
																sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 1, position: "relative" }}
															>
																<Box className="intelligence-provider-info" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
																	<Typography className="intelligence-provider-name" variant="body2" sx={{ fontWeight: 500 }}>{provider.name}</Typography>
																	<Box className="intelligence-provider-meta" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
																		<span className="intelligence-provider-badge" data-testid={`provider-type-badge-${provider.name}`}>
																			{provider.provider}
																		</span>
																		<span className="intelligence-provider-model">{provider.model}</span>
																		{provider.apiKeyConfigured && (
																			<span className="intelligence-provider-key-status" title="API key configured">🔑</span>
																		)}
																	</Box>
																</Box>
																<Box className="intelligence-provider-actions" sx={{ display: "flex", gap: 0.5, mt: 1 }}>
																	<Button
																		type="button"
																		className={`intelligence-set-active-btn ${isActive ? "is-active" : ""}`}
																		size="small"
																		onClick={() => setFormState((current) =>
																			current ? { ...current, intelligenceActiveProvider: provider.name } : current
																		)}
																		disabled={!formState.intelligenceEnabled}
																		title={isActive ? "Active provider" : "Set as active provider"}
																		data-testid={`provider-set-active-${provider.name}`}
																		variant={isActive ? "contained" : "outlined"}
																	>
																		{isActive ? "★ ACTIVE" : "SET ACTIVE"}
																	</Button>
																	<IconButton
																		type="button"
																		className="intelligence-edit-btn"
																		onClick={() => setFormState((current) =>
																			current ? {
																				...current,
																				editingProvider: {
																					...provider,
																					isNew: false,
																					apiKeyInput: "",
																					originalName: provider.name,
																				},
																			} : current
																		)}
																		disabled={!formState.intelligenceEnabled}
																		title="Edit provider"
																		data-testid={`provider-edit-${provider.name}`}
																		size="small"
																	>
																		✎
																	</IconButton>
																	<IconButton
																		type="button"
																		className="intelligence-delete-btn"
																		onClick={() => {
																			setFormState((current) => {
																				if (!current) return current;
																				const providers = current.intelligenceProviders.filter(
																					(p) => p.name !== provider.name
																				);
																				const activeProvider = current.intelligenceActiveProvider === provider.name
																					? (providers[0]?.name ?? "")
																					: current.intelligenceActiveProvider;
																				return {
																					...current,
																					intelligenceProviders: providers,
																					intelligenceActiveProvider: activeProvider,
																				};
																			});
																		}}
																		disabled={!formState.intelligenceEnabled}
																		title="Delete provider"
																		data-testid={`provider-delete-${provider.name}`}
																		size="small"
																	>
																		×
																	</IconButton>
																</Box>
																{isActive && (
																	<div className="intelligence-provider-active-indicator" data-testid={`provider-active-indicator-${provider.name}`} />
																)}
															</Box>
														);
													})}
												</Box>
											)}
										</Box>

										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Global Settings</Typography>
											<Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
												<div className="form-field">
													<label htmlFor="intelligence-max-bytes">Max Bytes</label>
													<input
														id="intelligence-max-bytes"
														type="number"
														value={formState.intelligenceMaxBytes}
														onChange={(event) => updateField("intelligenceMaxBytes", Number(event.target.value))}
														data-testid="intelligence-max-bytes-input"
														disabled={!formState.intelligenceEnabled}
													/>
												</div>
												<div className="form-field">
													<label htmlFor="intelligence-timeout-sec">Timeout (sec)</label>
													<input
														id="intelligence-timeout-sec"
														type="number"
														value={formState.intelligenceTimeoutSec}
														onChange={(event) => updateField("intelligenceTimeoutSec", Number(event.target.value))}
														data-testid="intelligence-timeout-sec-input"
														disabled={!formState.intelligenceEnabled}
													/>
												</div>
												<div className="form-field">
													<label htmlFor="intelligence-min-session-interval-sec">Min Session Interval (sec)</label>
													<input
														id="intelligence-min-session-interval-sec"
														type="number"
														value={formState.intelligenceMinSessionIntervalSec}
														onChange={(event) => updateField("intelligenceMinSessionIntervalSec", Number(event.target.value))}
														data-testid="intelligence-min-session-interval-sec-input"
														disabled={!formState.intelligenceEnabled}
													/>
												</div>
												<div className="form-field">
													<label htmlFor="intelligence-max-concurrency">Max Concurrency</label>
													<input
														id="intelligence-max-concurrency"
														type="number"
														value={formState.intelligenceMaxConcurrency}
														onChange={(event) => updateField("intelligenceMaxConcurrency", Number(event.target.value))}
														data-testid="intelligence-max-concurrency-input"
														disabled={!formState.intelligenceEnabled}
													/>
												</div>
												<div className="form-field">
													<label htmlFor="intelligence-cache-ttl-sec">Cache TTL (sec)</label>
													<input
														id="intelligence-cache-ttl-sec"
														type="number"
														value={formState.intelligenceCacheTTLSec}
														onChange={(event) => updateField("intelligenceCacheTTLSec", Number(event.target.value))}
														data-testid="intelligence-cache-ttl-sec-input"
														disabled={!formState.intelligenceEnabled}
													/>
												</div>
											</Box>
										</Box>
									</Box>
								)}

								{activeTab === "theme" && (
									<Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Theme</Typography>
											<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Global theme for the full application shell.</Typography>
											<div className="form-field">
												<div className="theme-grid">
													{THEME_OPTIONS.map((theme) => renderThemeCard("theme", formState.theme, theme.id))}
												</div>
											</div>
										</Box>
									</Box>
								)}

								{activeTab === "typography" && (
									<Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Typography</Typography>
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

											<Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mt: 2 }}>
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

												<div className="form-field">
													<label htmlFor="settings-terminal-font-weight">Terminal Font Weight</label>
													<select
														id="settings-terminal-font-weight"
														value={formState.terminalFontWeight}
														onChange={(event) => updateField("terminalFontWeight", normalizeTerminalFontWeight(event.target.value))}
														data-testid="settings-terminal-font-weight-input"
														className="font-weight-select"
													>
														{VALID_TERMINAL_FONT_WEIGHTS.map((weight) => (
															<option key={weight} value={weight}>
																{weight === "normal" ? "Normal" : weight === "bold" ? "Bold" : weight}
															</option>
														))}
													</select>
													<p className="form-help-text">Font weight for terminal text.</p>
												</div>
											</Box>
										</Box>
									</Box>
								)}
							</Box>

							<Box sx={{ p: 2, borderTop: 1, borderColor: "divider", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
								<div className="settings-footer-status">
									{isSaving && <span className="saving-indicator">Saving changes...</span>}
								</div>
								<Box sx={{ display: "flex", gap: 1 }}>
									<Button type="button" variant="outlined" onClick={handleCancel}>
										CANCEL
									</Button>
									<Button type="submit" variant="contained" disabled={isSaving || isLoading}>
										{isSaving ? "SAVING..." : "SAVE"}
									</Button>
								</Box>
							</Box>
						</form>
					</Box>
				</Box>
			)}
		</Dialog>
	);
}

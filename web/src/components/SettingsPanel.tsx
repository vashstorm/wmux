import { useEffect, useMemo, useState, useRef } from "react";
import { flushSync } from "react-dom";
import { Dialog, DialogTitle, DialogContent, Button, TextField, Select, FormControl, InputLabel, Typography, Box, IconButton, Switch, FormControlLabel, Slider, Chip, CircularProgress, List, ListItemButton, Stack, Tooltip, SvgIcon } from "@mui/material";
import { Add as AddIcon, Analytics as AnalyticsIcon, Close as CloseIcon, Delete as DeleteIcon, Edit as EditIcon, Extension as ExtensionIcon, Lan as LanIcon, Memory as MemoryIcon, SettingsOutlined as SettingsOutlinedIcon, SmartToy as SmartToyIcon, Star as StarIcon, TextFields as TextFieldsIcon, Remove as RemoveIcon, RestartAlt as RestartAltIcon } from "@mui/icons-material";
import { getConfig, type AppConfig, type IntelligenceProviderConfig, type ConnectionConfig, type ConnectionHealth, type OmniSkillConfig, updateConfig, deleteConnection, listConnectionHealth, connectionDisplayName, clearOmniHistory } from "../api/client.js";
import { ApiError, getErrorMessage } from "../api/errors.js";
import { useAppState } from "../state/store.js";
import { applyUIScaleStep, clampUIScaleStep, normalizeTerminalFontWeight, VALID_TERMINAL_FONT_WEIGHTS, fontSizeToScaleStep, DEFAULT_UI_SCALE_STEP, getUIFontBasePx, getTerminalFontPx, MIN_UI_SCALE_STEP, MAX_UI_SCALE_STEP } from "../ui/fontSize.js";
import { normalizeThemeId } from "../ui/themes.js";



interface ProviderFormState extends IntelligenceProviderConfig {
	isNew: boolean;
	apiKeyInput: string;
	originalName: string;
}

interface SettingsFormState {
	path: string;
	bind: string;
	tmuxPath: string;
	knownHostsPath: string;
	theme: string;
	windowTheme: string;
	tokenInput: string;
	tokenConfigured: boolean;
	uiScaleStep: number;
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
	omniEnabled: boolean;
	omniEndpoint: string;
	omniSkValue: string;
	omniSkConfigured: boolean;
	omniModel: string;
	omniVoice: string;
	omniMicrophoneDisabled: boolean;
	omniSkills: OmniSkillConfig[];
}

type SettingsTabKey = "general" | "connections" | "typography" | "intelligence" | "omni" | "omni-skills";

const SETTINGS_SECTIONS: Array<{
	key: SettingsTabKey;
	label: string;
	icon: typeof SettingsOutlinedIcon;
}> = [
	{
		key: "general",
		label: "General",
		icon: SettingsOutlinedIcon,
	},
	{
		key: "connections",
		label: "Connections",
		icon: LanIcon,
	},
	{
		key: "typography",
		label: "Typography",
		icon: TextFieldsIcon,
	},
	{
		key: "intelligence",
		label: "Window Analysis",
		icon: AnalyticsIcon,
	},
	{
		key: "omni",
		label: "AI Assistant",
		icon: SmartToyIcon,
	},
	{
		key: "omni-skills",
		label: "Assistant Skills",
		icon: ExtensionIcon,
	},
];

const BUILTIN_OMNI_SKILLS: OmniSkillConfig[] = [
	{ id: "navigate_frontend", enabled: true, description: "" },
	{ id: "invoke_backend_route", enabled: true, description: "" },
	{ id: "list_sessions", enabled: true, description: "" },
	{ id: "create_session", enabled: true, description: "" },
	{ id: "rename_session", enabled: true, description: "" },
	{ id: "delete_session", enabled: true, description: "" },
	{ id: "send_to_pane", enabled: true, description: "" },
	{ id: "confirm_action", enabled: true, description: "" },
	{ id: "cancel_action", enabled: true, description: "" },
];

function buildFormState(config: AppConfig): SettingsFormState {
	const sshConnection = config.connections.find((connection) => connection.type === "ssh");
	const intel = config.intelligence;

	const uiScaleStep = config.ui.uiScaleStep !== undefined
		? config.ui.uiScaleStep
		: config.ui.fontSize !== undefined
			? fontSizeToScaleStep(config.ui.fontSize)
			: DEFAULT_UI_SCALE_STEP;

	return {
		path: config.path,
		bind: config.server.bind,
		tmuxPath: config.tmux.path,
		knownHostsPath: sshConnection?.knownHostsPath ?? "~/.ssh/known_hosts",
		theme: normalizeThemeId(config.ui.theme),
		windowTheme: normalizeThemeId(config.ui.windowTheme, normalizeThemeId(config.ui.theme)),
		tokenInput: "",
		tokenConfigured: Boolean(config.auth.tokenConfigured),
		uiScaleStep,
		terminalFontSize: getTerminalFontPx(uiScaleStep),
		terminalFontWeight: normalizeTerminalFontWeight(config.ui.terminalFontWeight),
		intelligenceEnabled: intel?.enabled ?? false,
		intelligenceActiveProvider: intel?.activeProvider ?? "",
		intelligenceProviders: intel?.providers ?? [],
		intelligenceMaxBytes: intel?.maxBytes ?? 20000,
		intelligenceTimeoutSec: intel?.timeoutSec ?? 30,
		intelligenceMinSessionIntervalSec: intel?.minSessionIntervalSec ?? 60,
		intelligenceMaxConcurrency: intel?.maxConcurrency ?? 3,
		intelligenceCacheTTLSec: intel?.cacheTTLSec ?? 300,
		editingProvider: null,
		omniEnabled: config.voice?.enabled ?? false,
			omniEndpoint: config.voice?.endpoint ?? "",
			omniSkConfigured: config.voice?.dashscopeApiKeyConfigured ?? false,
		omniModel: config.voice?.model ?? "qwen3.5-omni-flash-realtime",
		omniVoice: config.voice?.voice ?? "",
		omniMicrophoneDisabled: config.voice?.microphoneDisabled ?? false,
			omniSkills: config.voice?.skills && config.voice.skills.length > 0 ? config.voice.skills : BUILTIN_OMNI_SKILLS,
			omniSkValue: "",
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
	const [activeTab, setActiveTab] = useState<SettingsTabKey>("general");
	const [omniSkShowPlain, setOmniSkShowPlain] = useState(false);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (scrollContainerRef.current) {
			scrollContainerRef.current.scrollTop = 0;
		}
	}, [activeTab]);

	const SK_STORAGE_KEY = "wmux-omni-sk";
	const knownHostsPlaceholder = useMemo(() => "~/.ssh/known_hosts", []);

	const loadConfig = async () => {
		setIsLoading(true);
		try {
			const response = await getConfig();
			const restoredSk = sessionStorage.getItem(SK_STORAGE_KEY) ?? "";
			const baseState = buildFormState(response);
			setFormState({ ...baseState, omniSkValue: restoredSk });
			setConfig(response);
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
			const healthMap: Record<string, ConnectionHealth> = {};
				for (const h of healthData) {
					healthMap[h.targetName] = h;
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
		applyUIScaleStep(formState.uiScaleStep);
		setUISettings({
			theme: formState.theme,
			windowTheme: formState.windowTheme,
			uiScaleStep: formState.uiScaleStep,
			terminalFontSize: getTerminalFontPx(formState.uiScaleStep),
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
			const result: IntelligenceProviderConfig & { apiKey?: string } = {
				name: p.name,
				provider: p.provider,
				model: p.model,
				baseURL: p.baseURL,
			};
			const storedKey = (p as IntelligenceProviderConfig & { apiKey?: string }).apiKey;
			if (storedKey) {
				result.apiKey = storedKey;
			}
			return result;
		});

		const fontSize = getUIFontBasePx(formState.uiScaleStep);

		return {
			...config,
			path: formState.path.trim(),
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
				uiScaleStep: formState.uiScaleStep,
				fontSize,
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
				voice: {
					enabled: formState.omniEnabled,
					dashscopeApiKeyConfigured: formState.omniSkConfigured || (formState.omniSkValue.trim().length > 0),
					dashscopeApiKey: formState.omniSkValue.trim() || undefined,
					microphoneDisabled: formState.omniMicrophoneDisabled,
					voice: formState.omniVoice || undefined,
					skills: formState.omniSkills,
					model: formState.omniModel,
					endpoint: formState.omniEndpoint,
					continuousListening: config.voice?.continuousListening ?? false,
					storeRawAudio: config.voice?.storeRawAudio ?? false,
					vadEnabled: config.voice?.vadEnabled ?? true,
					vadThreshold: config.voice?.vadThreshold ?? 0.5,
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
				if (formState?.omniSkValue.trim()) {
					sessionStorage.setItem(SK_STORAGE_KEY, formState.omniSkValue.trim());
				}
				setFormState(buildFormState(saved));
				setConnections(saved.connections);

				const savedScaleStep = saved.ui.uiScaleStep !== undefined
					? saved.ui.uiScaleStep
					: saved.ui.fontSize !== undefined
						? fontSizeToScaleStep(saved.ui.fontSize)
						: DEFAULT_UI_SCALE_STEP;

				applyUIScaleStep(savedScaleStep);
				setUISettings({
					theme: savedTheme,
					windowTheme: savedWindowTheme,
					uiScaleStep: savedScaleStep,
					terminalFontSize: getTerminalFontPx(savedScaleStep),
					terminalFontWeight: saved.ui.terminalFontWeight,
				});
				setConfigConflict(null);
				setShowSettingsPanel(false);

				if (formState?.tokenInput.trim()) {
					sessionStorage.setItem("wmux-auth-token", formState.tokenInput.trim());
				}
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
							path: payload.path,
							server: { ...latest.server, bind: payload.server.bind },
							auth: { token: payload.auth.token },
							tmux: { ...latest.tmux, path: payload.tmux.path },
							ui: { ...latest.ui, theme: payload.ui.theme, windowTheme: payload.ui.windowTheme, uiScaleStep: payload.ui.uiScaleStep, fontSize: payload.ui.fontSize, terminalFontSize: payload.ui.terminalFontSize, terminalFontWeight: payload.ui.terminalFontWeight },
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
							voice: payload.voice,
							connections: latest.connections.map((connection) => {
								if (connection.type !== "ssh") {
									return connection;
								}
								const pendingConnection = payload.connections.find((item) => item.targetName === connection.targetName);
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

			const uiScaleStep = config.ui.uiScaleStep !== undefined
				? config.ui.uiScaleStep
				: config.ui.fontSize !== undefined
					? fontSizeToScaleStep(config.ui.fontSize)
					: DEFAULT_UI_SCALE_STEP;

			applyUIScaleStep(uiScaleStep);
			setUISettings({
				theme,
				windowTheme,
				uiScaleStep,
				terminalFontSize: getTerminalFontPx(uiScaleStep),
				terminalFontWeight: config.ui.terminalFontWeight,
			});
		}
		closePanel();
	};

	const handleClearOmniHistory = async () => {
		try {
			await clearOmniHistory();
		} catch {
		}
	};

	const handleDeleteConnection = (connection: ConnectionConfig) => {
			showConfirm({
				title: "Delete Connection",
				message: `Delete connection "${connectionDisplayName(connection)}"? This cannot be undone.`,
				confirmText: "Delete Connection",
				confirmVariant: "danger",
				onConfirm: async () => {
					try {
						await deleteConnection(connection.targetName);
						const updated = connections.filter((c) => c.targetName !== connection.targetName);
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

	const handleEditConnection = (connection: ConnectionConfig) => {
			setEditingConnection(connection);
		};

	const handleNewConnection = () => {
		setEditingConnection(null);
		setShowNewConnectionForm(true);
	};

	const renderProviderEditor = (editor: ProviderFormState) => {
		return (
			<Box className="intelligence-provider-editor" data-testid="intelligence-provider-editor" sx={{ display: "flex", flexDirection: "column", gap: 2, p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}>
				<TextField
					id="provider-editor-name"
					label="Name"
					type="text"
					value={editor.name}
					onChange={(event) => setFormState((current) =>
						current && current.editingProvider
							? {
								...current,
								editingProvider: { ...current.editingProvider, name: event.target.value },
							}
							: current
					)}
					placeholder="my-anthropic"
					fullWidth
					slotProps={{
						htmlInput: {
							"data-testid": "provider-editor-name-input",
						},
					}}
				/>
				<FormControl fullWidth>
					<InputLabel htmlFor="provider-editor-type">Provider Type</InputLabel>
					<Select
						native
						id="provider-editor-type"
						label="Provider Type"
						value={editor.provider}
						onChange={(event) => setFormState((current) =>
							current && current.editingProvider
								? {
									...current,
									editingProvider: { ...current.editingProvider, provider: event.target.value },
								}
								: current
						)}
						inputProps={{
							id: "provider-editor-type",
							"data-testid": "provider-editor-type-select",
						}}
					>
						<option value="anthropic">anthropic</option>
						<option value="openai">openai</option>
					</Select>
				</FormControl>
				<TextField
					id="provider-editor-model"
					label="Model"
					type="text"
					value={editor.model}
					onChange={(event) => setFormState((current) =>
						current && current.editingProvider
							? {
								...current,
								editingProvider: { ...current.editingProvider, model: event.target.value },
							}
							: current
					)}
					placeholder="claude-sonnet-4-20250514"
					fullWidth
					slotProps={{
						htmlInput: {
							"data-testid": "provider-editor-model-input",
						},
					}}
				/>
				<TextField
					id="provider-editor-api-key"
					label="API Key"
					type="password"
					value={editor.apiKeyInput}
					onChange={(event) => setFormState((current) =>
						current && current.editingProvider
							? {
								...current,
								editingProvider: { ...current.editingProvider, apiKeyInput: event.target.value },
							}
							: current
					)}
					placeholder={editor.apiKeyConfigured && !editor.isNew ? "•••••••••••••••• (leave blank to keep existing)" : "sk-..."}
					autoComplete="new-password"
					fullWidth
					helperText={
						editor.apiKeyConfigured && !editor.isNew
							? "A key is configured. Enter a new value to replace it, or leave blank to keep existing."
							: "API key is required for new providers."
					}
					slotProps={{
						htmlInput: {
							"data-testid": "provider-editor-api-key-input",
						},
					}}
				/>
				<TextField
					id="provider-editor-base-url"
					label="Base URL"
					type="text"
					value={editor.baseURL ?? ""}
					onChange={(event) => setFormState((current) =>
						current && current.editingProvider
							? {
								...current,
								editingProvider: { ...current.editingProvider, baseURL: event.target.value },
							}
							: current
					)}
					placeholder="https://api.openrouter.ai/v1"
					fullWidth
					helperText="Optional custom endpoint for OpenAI-compatible providers."
					slotProps={{
						htmlInput: {
							"data-testid": "provider-editor-base-url-input",
						},
					}}
				/>
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

							const updatedProvider: IntelligenceProviderConfig & { apiKey?: string } = {
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
									intelligenceActiveProvider: current.intelligenceActiveProvider === current.editingProvider.originalName
										? updatedProvider.name
										: current.intelligenceActiveProvider,
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
		);
	};

	return (
		<Dialog
			open={showSettingsPanel}
			onClose={handleCancel}
			maxWidth="md"
			fullWidth
			data-testid="settings-panel"
			slotProps={{
				paper: {
					className: "settings-panel"
				}
			}}
		>
			<DialogTitle className="settings-panel-header" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 3 }}>
				<Box className="settings-panel-header-title">
					<Typography variant="h6" component="h3" className="form-title">Settings</Typography>
				</Box>
				<IconButton
					onClick={closePanel}
					aria-label="Close settings"
					sx={{ color: "text.secondary" }}
				>
					<CloseIcon fontSize="small" />
				</IconButton>
			</DialogTitle>

			{isLoading || !formState ? (
				<DialogContent className="settings-panel-loading">
					<Box sx={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "200px", gap: 2 }}>
						<CircularProgress size={40} />
						<Typography variant="body2" color="text.secondary">Loading settings...</Typography>
					</Box>
				</DialogContent>
			) : (
				<Box className="settings-panel-body" sx={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
					<Box
						role="complementary"
						className="settings-sidebar"
						sx={{
							width: 232,
							p: 1.5,
							display: "flex",
							flexDirection: "column",
						}}
					>
						<Box className="settings-sidebar-header" sx={{ px: 1, py: 1.25 }}>
							<Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0 }}>
								Workspace
							</Typography>
						</Box>
						<List component="nav" aria-label="Settings sections" className="settings-nav" data-testid="settings-nav" disablePadding sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
							{SETTINGS_SECTIONS.map((item) => {
								const SectionIcon = item.icon;
								const selected = activeTab === item.key;
								return (
									<ListItemButton
										key={item.key}
										selected={selected}
										onClick={() => flushSync(() => setActiveTab(item.key))}
										className={`settings-nav-item ${selected ? "is-active" : ""}`}
										data-testid={`settings-tab-${item.key}`}
										sx={{
											flex: "0 0 auto",
											minHeight: 36,
											px: 1,
											py: 0.625,
											gap: 1,
										}}
									>
										<SectionIcon className="nav-icon" sx={{ fontSize: 16, flexShrink: 0 }} />
										<Box sx={{ minWidth: 0 }}>
											<Typography variant="body2" sx={{ fontSize: "var(--font-size-sm)", fontWeight: selected ? 700 : 600, lineHeight: 1.2 }}>
												{item.label}
											</Typography>
											<Typography variant="caption" color="text.secondary" className="settings-panel-subtitle" sx={{ display: "block", mt: 0.125, lineHeight: 1.2 }}>
												{item.key === "general" ? "Core config" : item.key === "connections" ? `${connections.length} configured` : item.key === "typography" ? `scale ${formState.uiScaleStep}` : item.key === "intelligence" ? (formState.intelligenceEnabled ? "Enabled" : "Disabled") : item.key === "omni" ? (formState.omniEnabled ? "Enabled" : "Disabled") : `${formState.omniSkills.filter((s) => s.enabled).length}/${formState.omniSkills.length}`}
											</Typography>
										</Box>
									</ListItemButton>
								);
							})}
						</List>

						<Box className="settings-sidebar-footer" sx={{ mt: "auto", p: 1 }}>
							<Typography variant="caption" color="text.secondary" className="version-info">wmux v{window.performance ? "0.1.0" : "dev"}</Typography>
						</Box>
					</Box>

					<Box className="settings-main" sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
						<form className="settings-form" onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
							<Box className="settings-content-scroll" sx={{ flex: 1, overflow: "auto" }} ref={scrollContainerRef}>
								{activeTab === "general" && (
									<Box className="settings-tab-content" sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
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
													id="settings-runtime-path"
													label="Runtime Path"
													type="text"
													value={formState.path}
													onChange={(event) => updateField("path", event.target.value)}
													data-testid="settings-runtime-path-input"
													placeholder="."
													fullWidth
													helperText="Base directory for logs and SQLite data."
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
									<Box className="settings-tab-content" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
										<Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
											<Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Managed Connections</Typography>
											<Button
												type="button"
												variant="contained"
												size="small"
												onClick={handleNewConnection}
												startIcon={<AddIcon />}
											>
												NEW
											</Button>
										</Box>

										{connections.length === 0 ? (
											<Box sx={{ textAlign: "center", py: 4 }}>
												<Typography component="div" sx={{ fontSize: 48, lineHeight: 1 }}>🔌</Typography>
												<Typography sx={{ my: 1 }}>No connections configured yet</Typography>
												<Button variant="contained" size="small" onClick={handleNewConnection} startIcon={<AddIcon />}>NEW</Button>
											</Box>
										) : (
											<Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
												{connections.map((connection) => {
													const connHealth = connectionHealth[connection.targetName];
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
														<Box
															key={connection.targetName}
															component="li"
															className="settings-connection-item"
															sx={{
																display: "flex",
																alignItems: "center",
																justifyContent: "space-between",
																p: 1.5,
																mb: 1,
																border: 1,
																borderColor: "divider",
																borderRadius: 1,
																bgcolor: "background.paper",
															}}
														>
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
																	<Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
																		<Typography className="settings-connection-name" variant="body2" sx={{ fontWeight: 700 }}>{connectionDisplayName(connection)}</Typography>
																		<Chip label={typeLabel} size="small" variant="outlined" />
																	</Stack>
																	<Typography className="settings-connection-meta" variant="caption" color="text.secondary">{subtitle}</Typography>
																</Box>
															</Box>
															<Box className="settings-connection-actions" sx={{ display: "flex", gap: 0.5 }}>
																<Tooltip title="Edit connection">
																	<IconButton
																		type="button"
																		className="connection-edit-btn"
																		onClick={() => handleEditConnection(connection)}
																		aria-label="Edit connection"
																		size="small"
																	>
																		<EditIcon fontSize="small" />
																	</IconButton>
																</Tooltip>
																<Tooltip title="Delete connection">
																	<IconButton
																		type="button"
																		className="connection-delete-btn"
																		onClick={() => handleDeleteConnection(connection)}
																		aria-label="Delete connection"
																		size="small"
																		color="error"
																	>
																		<DeleteIcon fontSize="small" />
																	</IconButton>
																</Tooltip>
															</Box>
														</Box>
													);
												})}
											</Box>
										)}
									</Box>
								)}

								{activeTab === "intelligence" && (
									<Box className="settings-tab-content" sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Window Analysis</Typography>
											<FormControlLabel
												control={
													<Switch
														id="intelligence-enabled"
														checked={formState.intelligenceEnabled}
														onChange={(event) => updateField("intelligenceEnabled", event.target.checked)}
														slotProps={{
															input: {
																"data-testid": "intelligence-enabled-checkbox",
															} as React.InputHTMLAttributes<HTMLInputElement>,
														}}
													/>
												}
												label="Enable Window Analysis"
											/>
											<Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, mb: 2 }} data-testid="intelligence-projects-context">
												Projects use the active AI provider to generate window analysis HTML summaries for your project dashboard.
											</Typography>
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
													startIcon={<AddIcon />}
												>
													ADD PROVIDER
												</Button>
											</Box>

											{formState.editingProvider?.isNew && renderProviderEditor(formState.editingProvider)}

											{formState.intelligenceProviders.length === 0 && !formState.editingProvider ? (
												<Box className="intelligence-providers-empty" data-testid="intelligence-providers-empty" sx={{ textAlign: "center", py: 4 }}>
													<Typography component="div" sx={{ fontSize: 48, lineHeight: 1 }}>🤖</Typography>
													<Typography>No providers configured yet. Add a provider to get started.</Typography>
												</Box>
											) : (
												<Box component="ul" className="intelligence-providers-list" data-testid="intelligence-providers-list" sx={{ listStyle: "none", p: 0, m: 0, display: "flex", flexDirection: "column", gap: 2 }}>
													{formState.intelligenceProviders.map((provider) => {
														const isActive = provider.name === formState.intelligenceActiveProvider;
														const isEditing = formState.editingProvider?.originalName === provider.name && !formState.editingProvider.isNew;
														return (
															<Box
																key={provider.name}
																component="li"
																className={`intelligence-provider-card ${isActive ? "is-active" : ""}`}
																data-testid={`intelligence-provider-card-${provider.name}`}
																sx={{
																	display: "flex",
																	flexDirection: "column",
																	alignItems: "stretch",
																	justifyContent: "space-between",
																	gap: 2,
																	p: 1.5,
																	border: 1,
																	borderColor: isActive ? "primary.main" : "divider",
																	borderRadius: 1,
																	position: "relative",
																	bgcolor: isActive ? "action.selected" : "background.paper",
																}}
															>
																<Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
																	<Box className="intelligence-provider-info" sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
																		<Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
																			<Typography className="intelligence-provider-name" variant="body2" sx={{ fontWeight: 700 }} noWrap>{provider.name}</Typography>
																			{isActive && <Chip label="Active" size="small" color="primary" />}
																		</Stack>
																		<Box className="intelligence-provider-meta" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
																			<Chip
																				className="intelligence-provider-badge"
																				data-testid={`provider-type-badge-${provider.name}`}
																				label={provider.provider}
																				size="small"
																				variant="outlined"
																			/>
																			<Typography className="intelligence-provider-model" component="span" variant="caption" color="text.secondary">{provider.model}</Typography>
																			{provider.apiKeyConfigured && (
																				<Chip
																					className="intelligence-provider-key-configured"
																					data-testid={`provider-key-configured-${provider.name}`}
																					label="Configured"
																					size="small"
																					color="success"
																					variant="outlined"
																				/>
																			)}
																		</Box>
																	</Box>
																	<Box className="intelligence-provider-actions" sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
																		<Tooltip title={isActive ? "Active provider" : "Set as active provider"}>
																			<span>
																				<IconButton
																					type="button"
																					className={`intelligence-set-active-btn ${isActive ? "is-active" : ""}`}
																					onClick={() => setFormState((current) =>
																						current ? { ...current, intelligenceActiveProvider: provider.name } : current
																					)}
																					disabled={!formState.intelligenceEnabled}
																					aria-label={isActive ? "Active provider" : `Set ${provider.name} as active provider`}
																					data-testid={`provider-set-active-${provider.name}`}
																					size="small"
																					color={isActive ? "primary" : "default"}
																				>
																					<StarIcon fontSize="small" />
																				</IconButton>
																			</span>
																		</Tooltip>
																		<Tooltip title="Edit provider">
																			<span>
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
																					aria-label="Edit provider"
																					data-testid={`provider-edit-${provider.name}`}
																					size="small"
																				>
																					<EditIcon fontSize="small" />
																				</IconButton>
																			</span>
																		</Tooltip>
																		<Tooltip title="Delete provider">
																			<span>
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
																					aria-label="Delete provider"
																					data-testid={`provider-delete-${provider.name}`}
																					size="small"
																					color="error"
																				>
																					<DeleteIcon fontSize="small" />
																				</IconButton>
																			</span>
																		</Tooltip>
																	</Box>
																</Box>
																{isEditing && formState.editingProvider && renderProviderEditor(formState.editingProvider)}
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
												<TextField
													id="intelligence-max-bytes"
													label="Max Bytes"
													type="number"
													value={formState.intelligenceMaxBytes}
													onChange={(event) => updateField("intelligenceMaxBytes", Number(event.target.value))}
													disabled={!formState.intelligenceEnabled}
													fullWidth
													slotProps={{
														htmlInput: {
															"data-testid": "intelligence-max-bytes-input",
														},
													}}
												/>
												<TextField
													id="intelligence-timeout-sec"
													label="Timeout (sec)"
													type="number"
													value={formState.intelligenceTimeoutSec}
													onChange={(event) => updateField("intelligenceTimeoutSec", Number(event.target.value))}
													disabled={!formState.intelligenceEnabled}
													fullWidth
													slotProps={{
														htmlInput: {
															"data-testid": "intelligence-timeout-sec-input",
														},
													}}
												/>
												<TextField
													id="intelligence-min-session-interval-sec"
													label="Min Session Interval (sec)"
													type="number"
													value={formState.intelligenceMinSessionIntervalSec}
													onChange={(event) => updateField("intelligenceMinSessionIntervalSec", Number(event.target.value))}
													disabled={!formState.intelligenceEnabled}
													fullWidth
													slotProps={{
														htmlInput: {
															"data-testid": "intelligence-min-session-interval-sec-input",
														},
													}}
												/>
												<TextField
													id="intelligence-max-concurrency"
													label="Max Concurrency"
													type="number"
													value={formState.intelligenceMaxConcurrency}
													onChange={(event) => updateField("intelligenceMaxConcurrency", Number(event.target.value))}
													disabled={!formState.intelligenceEnabled}
													fullWidth
													slotProps={{
														htmlInput: {
															"data-testid": "intelligence-max-concurrency-input",
														},
													}}
												/>
												<TextField
													id="intelligence-cache-ttl-sec"
													label="Cache TTL (sec)"
													type="number"
													value={formState.intelligenceCacheTTLSec}
													onChange={(event) => updateField("intelligenceCacheTTLSec", Number(event.target.value))}
													disabled={!formState.intelligenceEnabled}
													fullWidth
													slotProps={{
														htmlInput: {
															"data-testid": "intelligence-cache-ttl-sec-input",
														},
													}}
												/>
											</Box>
										</Box>
									</Box>
								)}

								{activeTab === "omni" && (
									<Box className="settings-tab-content" sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>AI Assistant</Typography>
											<FormControlLabel
												control={
													<Switch
														id="omni-enabled"
														checked={formState.omniEnabled}
														onChange={(event) => updateField("omniEnabled", event.target.checked)}
														slotProps={{
															input: {
																"data-testid": "omni-enabled-toggle",
															} as React.InputHTMLAttributes<HTMLInputElement>,
														}}
													/>
												}
												label="Enable AI Assistant"
											/>
											<Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, mb: 2 }}>
												AI Assistant allows hands-free operation via Qwen3.5-Omni.
											</Typography>
										</Box>

										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>API Configuration</Typography>
											<Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
												<TextField
													id="omni-base-url"
													label="Base URL"
													type="text"
													value={formState.omniEndpoint}
													onChange={(event) => updateField("omniEndpoint", event.target.value)}
													placeholder="wss://dashscope.aliyuncs.com/api-ws/v1/inference"
													fullWidth
													slotProps={{
														htmlInput: {
															"data-testid": "omni-base-url-input",
														},
													}}
												/>
												<TextField
													id="omni-model"
													label="Model"
													type="text"
													value={formState.omniModel}
													onChange={(event) => updateField("omniModel", event.target.value)}
													placeholder="qwen3.5-omni-flash-realtime"
													fullWidth
													slotProps={{
														htmlInput: {
															"data-testid": "omni-model-input",
														},
													}}
												/>
											</Box>
													<TextField
														id="omni-sk"
														label="SK / API Key"
														type={omniSkShowPlain ? "text" : "password"}
														value={formState.omniSkValue}
														onChange={(event) => updateField("omniSkValue", event.target.value)}
														placeholder={formState.omniSkConfigured && !formState.omniSkValue ? "•••••••• (configured)" : "sk-..."}
														fullWidth
														autoComplete="new-password"
														className="password-input-wrapper"
														sx={{ mt: 2 }}
														slotProps={{
															htmlInput: {
																"data-testid": "omni-sk-input",
															},
															input: {
																endAdornment: (
																	<IconButton
																		type="button"
																		tabIndex={-1}
																		onMouseDown={(e) => e.preventDefault()}
																		onClick={() => setOmniSkShowPlain((v) => !v)}
																		size="small"
																		sx={{ mr: 0.5 }}
																		aria-label={omniSkShowPlain ? "Hide API Key" : "Show API Key"}
																	>
																		{omniSkShowPlain ? (
																			<SvgIcon fontSize="small">
																				<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
																		</SvgIcon>
																	) : (
																		<SvgIcon fontSize="small">
																			<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
																		</SvgIcon>
																	)}
																</IconButton>
															),
														},
													}}
													/>
												</Box>

										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Voice Settings</Typography>
											<Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
												<TextField
													id="voice-voice"
													label="Voice / Timbre"
													type="text"
													value={formState.omniVoice}
													onChange={(event) => updateField("omniVoice", event.target.value)}
													placeholder="Chelsie"
													fullWidth
													slotProps={{
														htmlInput: {
															"data-testid": "omni-voice-input",
														},
													}}
												/>
												<FormControlLabel
													control={
														<Switch
															id="omni-microphone-disabled"
															checked={formState.omniMicrophoneDisabled}
															onChange={(event) => updateField("omniMicrophoneDisabled", event.target.checked)}
															slotProps={{
																input: {
																	"data-testid": "omni-microphone-disabled-toggle",
																} as React.InputHTMLAttributes<HTMLInputElement>,
															}}
														/>
													}
													label="Disable Microphone"
												/>
											</Box>
										</Box>

										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Voice History</Typography>
											<Button
												type="button"
												variant="outlined"
												color="error"
												onClick={() => {
													void handleClearOmniHistory();
												}}
												startIcon={<DeleteIcon />}
												data-testid="omni-history-clear"
											>
												CLEAR HISTORY
											</Button>
										</Box>
									</Box>
								)}

								{activeTab === "omni-skills" && (
									<Box className="settings-tab-content" sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Assistant Skills</Typography>
											<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
												Configure which skills are available to the AI assistant. Each skill has a description used by the AI to determine when to invoke it.
											</Typography>
											<Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, display: "flex", flexDirection: "column", gap: 2 }}>
												{formState.omniSkills.map((skill) => (
													<Box
														key={skill.id}
														component="li"
														sx={{
															display: "flex",
															alignItems: "flex-start",
															gap: 2,
															p: 1.5,
															border: 1,
															borderColor: "divider",
															borderRadius: 1,
															bgcolor: skill.enabled ? "action.selected" : "background.paper",
														}}
													>
														<Switch
															id={`omni-skill-${skill.id}`}
															checked={skill.enabled}
															onChange={(event) => {
																const updated = formState.omniSkills.map((s) =>
																	s.id === skill.id ? { ...s, enabled: event.target.checked } : s
																);
																updateField("omniSkills", updated);
															}}
															size="small"
															slotProps={{
																input: {
																	"data-testid": `omni-skill-${skill.id}-enabled`,
																} as React.InputHTMLAttributes<HTMLInputElement>,
															}}
															sx={{ mt: 0.25, flexShrink: 0 }}
														/>
														<TextField
															id={`omni-skill-desc-${skill.id}`}
															label={skill.id}
															type="text"
															value={skill.description}
															onChange={(event) => {
																const updated = formState.omniSkills.map((s) =>
																	s.id === skill.id ? { ...s, description: event.target.value } : s
																);
																updateField("omniSkills", updated);
															}}
															placeholder="Skill description..."
															size="small"
															fullWidth
															slotProps={{
																htmlInput: {
																	"data-testid": `omni-skill-${skill.id}-description`,
																},
															}}
														/>
													</Box>
												))}
											</Box>
										</Box>
									</Box>
								)}

								{activeTab === "typography" && (
									<Box className="settings-tab-content" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
										<Box>
											<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Typography</Typography>
											<Box
												data-testid="settings-typography-preview"
												sx={{
													mb: 2.5,
													p: 2,
													border: 1,
													borderColor: "divider",
													borderRadius: 1,
													bgcolor: "background.paper",
												}}
											>
												<Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
													<MemoryIcon sx={{ fontSize: 16, color: "text.secondary" }} />
													<Typography variant="caption" color="text.secondary">wmux terminal preview</Typography>
												</Stack>
												<Typography
													component="div"
													sx={{
														fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
														fontSize: `${getTerminalFontPx(formState.uiScaleStep)}px`,
														fontWeight: formState.terminalFontWeight,
														lineHeight: 1.55,
														color: "text.primary",
														whiteSpace: "pre-wrap",
													}}
												>{`$ tmux ls
main: 2 windows (created today)
ui: scale ${formState.uiScaleStep > 0 ? "+" : ""}${formState.uiScaleStep}`}</Typography>
											</Box>
											<Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
												<Typography component="label" variant="body2">UI Scale Step</Typography>
												<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
													<IconButton
														data-testid="settings-scale-decrease"
														onClick={() => updateField("uiScaleStep", clampUIScaleStep(formState.uiScaleStep - 1))}
														disabled={formState.uiScaleStep <= MIN_UI_SCALE_STEP}
														size="small"
														aria-label="Decrease UI scale step"
													>
														<RemoveIcon />
													</IconButton>
													<Typography
														data-testid="settings-scale-value"
														sx={{
															minWidth: 32,
															textAlign: "center",
															fontFamily: "'SFMono-Regular', Consolas, monospace",
															fontWeight: 600,
														}}
													>
														{formState.uiScaleStep > 0 ? `+${formState.uiScaleStep}` : formState.uiScaleStep}
													</Typography>
													<IconButton
														data-testid="settings-scale-increase"
														onClick={() => updateField("uiScaleStep", clampUIScaleStep(formState.uiScaleStep + 1))}
														disabled={formState.uiScaleStep >= MAX_UI_SCALE_STEP}
														size="small"
														aria-label="Increase UI scale step"
													>
														<AddIcon />
													</IconButton>
													<IconButton
														data-testid="settings-scale-reset"
														onClick={() => updateField("uiScaleStep", DEFAULT_UI_SCALE_STEP)}
														size="small"
														aria-label="Reset UI scale step"
													>
														<RestartAltIcon />
													</IconButton>
												</Box>
											</Box>

											<Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 2 }}>
												<FormControl fullWidth>
													<InputLabel htmlFor="settings-terminal-font-weight">Terminal Font Weight</InputLabel>
													<Select
														native
														id="settings-terminal-font-weight"
														label="Terminal Font Weight"
														value={formState.terminalFontWeight}
														onChange={(event) => updateField("terminalFontWeight", normalizeTerminalFontWeight(event.target.value))}
														inputProps={{
															id: "settings-terminal-font-weight",
															"data-testid": "settings-terminal-font-weight-input",
														}}
													>
														{VALID_TERMINAL_FONT_WEIGHTS.map((weight) => (
															<option key={weight} value={weight}>
																{weight === "normal" ? "Normal" : weight === "bold" ? "Bold" : weight}
															</option>
														))}
													</Select>
													<Typography variant="caption" color="text.secondary" sx={{ mt: 0.75 }}>Font weight for terminal text. Size follows UI scale step.</Typography>
												</FormControl>
											</Box>
										</Box>
									</Box>
								)}
							</Box>

							<Box sx={{ p: 2, borderTop: 1, borderColor: "divider", display: "flex", alignItems: "center", justifyContent: "space-between", bgcolor: "background.paper" }}>
								<Box className="settings-footer-status" sx={{ minHeight: 24, display: "flex", alignItems: "center", gap: 1 }}>
									{isSaving && (
										<>
											<CircularProgress size={16} />
											<Typography variant="caption" color="text.secondary">Saving changes...</Typography>
										</>
									)}
								</Box>
								<Box sx={{ display: "flex", gap: 1 }}>
									<Button type="button" variant="outlined" onClick={handleCancel}>
										Cancel
									</Button>
									<Button type="submit" variant="contained" disabled={isSaving || isLoading}>
										{isSaving ? "Saving..." : "Save"}
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

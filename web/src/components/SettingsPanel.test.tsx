import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { SettingsPanel } from "./SettingsPanel.js";
import { ErrorBanner } from "./ErrorBanner.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { AppProvider, useAppState } from "../state/store.js";
import * as client from "../api/client.js";
import { THEME_OPTIONS } from "../ui/themes.js";

const THEME_LABELS: Record<string, string> = {
	light: "Light",
	dark: "Dark",
};

vi.mock("../api/client.js", () => ({
	getConfig: vi.fn(),
	updateConfig: vi.fn(),
	deleteConnection: vi.fn(),
	listConnectionHealth: vi.fn(),
	connectionDisplayName: vi.fn((conn: { type: string; host?: string; targetName: string }) => {
		if (conn.type === "local") return "local";
		return conn.host ?? conn.targetName;
	}),
}));

const mockGetConfig = vi.mocked(client.getConfig);
const mockUpdateConfig = vi.mocked(client.updateConfig);
const mockListConnectionHealth = vi.mocked(client.listConnectionHealth);

function TestWrapper({ children }: { children: React.ReactNode }) {
	return <AppProvider>{children}</AppProvider>;
}

function enableSettingsPanel() {
	function Opener() {
		const { setShowSettingsPanel } = useAppState();
		useEffect(() => {
			setShowSettingsPanel(true);
		}, [setShowSettingsPanel]);
		return null;
	}
	return <Opener />;
}

const defaultConfig = {
	schemaVersion: 1,
	path: ".",
	server: { bind: "127.0.0.1:7331" },
	auth: { token: "", tokenConfigured: false },
	tmux: { path: "tmux" },
	connections: [{ targetName: "conn1", type: "local" }],
	ui: { theme: "dark", windowTheme: "dark", uiScaleStep: 0, terminalFontSize: 14, terminalFontWeight: "normal" },
	intelligence: {
		enabled: false,
		activeProvider: "",
		providers: [] as Array<{ name: string; provider: string; model: string; apiKey?: string; apiKeyConfigured?: boolean; baseURL?: string }>,
		maxBytes: 4096,
		timeoutSec: 30,
		minSessionIntervalSec: 60,
		maxConcurrency: 3,
		cacheTTLSec: 300,
	},
	logs: { level: "info" },
};

describe("SettingsPanel intelligence section", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("Settings panel renders intelligence section with AI Intelligence heading", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		expect(screen.getByRole("button", { name: /AI/i })).toBeInTheDocument();
	});

	test("Typography tab renders font controls", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		expect(screen.getByTestId("settings-scale-decrease")).toBeInTheDocument();
		expect(screen.getByTestId("settings-scale-increase")).toBeInTheDocument();
		expect(screen.getByTestId("settings-scale-reset")).toBeInTheDocument();
		expect(screen.getByTestId("settings-scale-value")).toBeInTheDocument();
		expect(screen.getByTestId("settings-terminal-font-weight-input")).toBeInTheDocument();
	});

	function navigateToIntelligenceTab() {
		const intelligenceNavButton = screen.getByRole("button", { name: /AI/i });
		fireEvent.click(intelligenceNavButton);
	}

	test("When intelligence.enabled is false add provider button is disabled", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const addProviderBtn = screen.getByTestId("intelligence-add-provider-btn") as HTMLButtonElement;
		expect(addProviderBtn.disabled).toBe(true);
	});

	test("When intelligence enabled toggle is turned on add provider button becomes enabled", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		const addProviderBtn = screen.getByTestId("intelligence-add-provider-btn") as HTMLButtonElement;
		expect(addProviderBtn.disabled).toBe(false);
	});

	test("Add provider opens editor form", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		const addProviderBtn = screen.getByTestId("intelligence-add-provider-btn");
		fireEvent.click(addProviderBtn);

		await waitFor(() => {
			expect(screen.getByTestId("intelligence-provider-editor")).toBeInTheDocument();
		});

		expect(screen.getByTestId("provider-editor-name-input")).toBeInTheDocument();
		expect(screen.getByTestId("provider-editor-type-select")).toBeInTheDocument();
		expect(screen.getByTestId("provider-editor-model-input")).toBeInTheDocument();
		expect(screen.getByTestId("provider-editor-api-key-input")).toBeInTheDocument();
		expect(screen.getByTestId("provider-editor-base-url-input")).toBeInTheDocument();
	});

	test("Settings custom controls are rendered through MUI inputs", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		expect(enableToggle.closest(".MuiSwitch-root")).not.toBeNull();
		fireEvent.click(enableToggle);

		fireEvent.click(screen.getByTestId("intelligence-add-provider-btn"));

		expect(screen.getByTestId("provider-editor-name-input").closest(".MuiTextField-root")).not.toBeNull();
		expect(screen.getByTestId("provider-editor-type-select").closest(".MuiFormControl-root")).not.toBeNull();
		expect(screen.getByTestId("provider-editor-model-input").closest(".MuiTextField-root")).not.toBeNull();
		expect(screen.getByTestId("provider-editor-api-key-input").closest(".MuiTextField-root")).not.toBeNull();
		expect(screen.getByTestId("provider-editor-base-url-input").closest(".MuiTextField-root")).not.toBeNull();

		expect(screen.getByTestId("intelligence-max-bytes-input").closest(".MuiTextField-root")).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		const decreaseBtn = screen.getByTestId("settings-scale-decrease") as HTMLButtonElement;
		expect(decreaseBtn).toBeInTheDocument();
		const increaseBtn = screen.getByTestId("settings-scale-increase") as HTMLButtonElement;
		expect(increaseBtn).toBeInTheDocument();
		const resetBtn = screen.getByTestId("settings-scale-reset") as HTMLButtonElement;
		expect(resetBtn).toBeInTheDocument();
		expect(screen.getByTestId("settings-scale-value")).toBeInTheDocument();
		expect(screen.getByTestId("settings-terminal-font-weight-input").closest(".MuiFormControl-root")).not.toBeNull();
	});

	test("Settings panel exposes cleaner navigation without duplicate section title", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		expect(screen.getByTestId("settings-nav")).toHaveAttribute("aria-label", "Settings sections");
		expect(screen.queryByText("Configure your wmux workspace")).not.toBeInTheDocument();
		expect(screen.queryByTestId("settings-active-section-title")).not.toBeInTheDocument();
		expect(screen.queryByTestId("settings-active-section-description")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		expect(screen.queryByTestId("settings-active-section-title")).not.toBeInTheDocument();
		expect(screen.getByTestId("settings-typography-preview")).toHaveTextContent("wmux terminal preview");
	});

	test("Save payload includes intelligence object with providers array", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);
		mockUpdateConfig.mockResolvedValue(defaultConfig);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		const addProviderBtn = screen.getByTestId("intelligence-add-provider-btn");
		fireEvent.click(addProviderBtn);

		const nameInput = screen.getByTestId("provider-editor-name-input") as HTMLInputElement;
		fireEvent.change(nameInput, { target: { value: "my-anthropic" } });

		const modelInput = screen.getByTestId("provider-editor-model-input") as HTMLInputElement;
		fireEvent.change(modelInput, { target: { value: "claude-sonnet-4" } });

		const apiKeyInput = screen.getByTestId("provider-editor-api-key-input") as HTMLInputElement;
		fireEvent.change(apiKeyInput, { target: { value: "sk-test-key" } });

		const baseURLInput = screen.getByTestId("provider-editor-base-url-input") as HTMLInputElement;
		fireEvent.change(baseURLInput, { target: { value: "https://api.openrouter.ai/v1" } });

		const saveProviderBtn = screen.getByTestId("provider-editor-save-btn");
		fireEvent.click(saveProviderBtn);

		const setActiveBtn = screen.getByTestId("provider-set-active-my-anthropic");
		fireEvent.click(setActiveBtn);

		const saveButton = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(mockUpdateConfig).toHaveBeenCalled();
		});

		const callArg = mockUpdateConfig.mock.calls[0]?.[0];
		expect(callArg).toBeDefined();
		expect(callArg?.intelligence?.enabled).toBe(true);
		expect(callArg?.intelligence?.activeProvider).toBe("my-anthropic");
		expect(callArg?.intelligence?.providers).toHaveLength(1);
		expect(callArg?.intelligence?.providers[0]?.name).toBe("my-anthropic");
		expect(callArg?.intelligence?.providers[0]?.provider).toBe("anthropic");
		expect(callArg?.intelligence?.providers[0]?.model).toBe("claude-sonnet-4");
		expect(callArg?.intelligence?.providers[0]?.baseURL).toBe("https://api.openrouter.ai/v1");
	});

	test("Intelligence form fields load from existing config values", async () => {
		const configWithIntelligence = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "my-openai",
				providers: [
					{
						name: "my-openai",
						provider: "openai",
						model: "gpt-4o",
						apiKey: "",
						apiKeyConfigured: true,
						baseURL: "https://api.openai.com/v1",
					},
				],
				maxBytes: 8192,
				timeoutSec: 60,
				minSessionIntervalSec: 120,
				maxConcurrency: 5,
				cacheTTLSec: 600,
			},
		};

		mockGetConfig.mockResolvedValue(configWithIntelligence);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		expect(enableToggle.checked).toBe(true);

		expect(screen.getByText("my-openai")).toBeInTheDocument();
		expect(screen.getByText("gpt-4o")).toBeInTheDocument();
		expect(screen.getByTestId("provider-type-badge-my-openai")).toHaveTextContent("openai");
	});

	test("When intelligence is enabled without providers, save is blocked and error is shown", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		const saveButton = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(mockUpdateConfig).not.toHaveBeenCalled();
		});

		expect(screen.getByTestId("error-banner")).toBeInTheDocument();
		expect(screen.getByText("At least one provider is required when intelligence is enabled")).toBeInTheDocument();
	});

	test("When intelligence is enabled without activeProvider, save is blocked", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "",
				providers: [
					{
						name: "my-provider",
						provider: "anthropic",
						model: "claude-sonnet-4",
						apiKeyConfigured: true,
					},
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const saveButton = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(mockUpdateConfig).not.toHaveBeenCalled();
		});

		expect(screen.getByTestId("error-banner")).toBeInTheDocument();
		expect(screen.getByText("An active provider must be selected when intelligence is enabled")).toBeInTheDocument();
	});

	test("Delete provider removes it from the list", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "my-provider",
				providers: [
					{
						name: "my-provider",
						provider: "anthropic",
						model: "claude-sonnet-4",
						apiKeyConfigured: true,
					},
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const deleteBtn = screen.getByTestId("provider-delete-my-provider");
		fireEvent.click(deleteBtn);

		expect(screen.queryByText("my-provider")).not.toBeInTheDocument();
	});

	test("Edit existing provider opens editor with pre-populated fields", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "my-provider",
				providers: [
					{
						name: "my-provider",
						provider: "openai",
						model: "gpt-4o",
						apiKeyConfigured: true,
						baseURL: "https://api.openai.com/v1",
					},
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const editBtn = screen.getByTestId("provider-edit-my-provider");
		fireEvent.click(editBtn);

		await waitFor(() => {
			expect(screen.getByTestId("intelligence-provider-editor")).toBeInTheDocument();
		});
		expect(screen.getByTestId("intelligence-provider-card-my-provider")).toContainElement(
			screen.getByTestId("intelligence-provider-editor"),
		);

		const nameInput = screen.getByTestId("provider-editor-name-input") as HTMLInputElement;
		expect(nameInput.value).toBe("my-provider");
		const typeSelect = screen.getByTestId("provider-editor-type-select") as HTMLSelectElement;
		expect(typeSelect.value).toBe("openai");
		const modelInput = screen.getByTestId("provider-editor-model-input") as HTMLInputElement;
		expect(modelInput.value).toBe("gpt-4o");
		const baseURLInput = screen.getByTestId("provider-editor-base-url-input") as HTMLInputElement;
		expect(baseURLInput.value).toBe("https://api.openai.com/v1");
		const apiKeyInput = screen.getByTestId("provider-editor-api-key-input") as HTMLInputElement;
		expect(apiKeyInput.value).toBe("");
	});

	test("Edit provider and modify fields updates provider in list", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "my-provider",
				providers: [
					{
						name: "my-provider",
						provider: "anthropic",
						model: "claude-3",
						apiKeyConfigured: true,
					},
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const editBtn = screen.getByTestId("provider-edit-my-provider");
		fireEvent.click(editBtn);

		await waitFor(() => {
			expect(screen.getByTestId("intelligence-provider-editor")).toBeInTheDocument();
		});

		const modelInput = screen.getByTestId("provider-editor-model-input") as HTMLInputElement;
		fireEvent.change(modelInput, { target: { value: "claude-sonnet-4" } });

		const nameInput = screen.getByTestId("provider-editor-name-input") as HTMLInputElement;
		fireEvent.change(nameInput, { target: { value: "updated-name" } });

		const saveProviderBtn = screen.getByTestId("provider-editor-save-btn");
		fireEvent.click(saveProviderBtn);

		expect(screen.getByText("updated-name")).toBeInTheDocument();
		expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument();
	});

	test("Delete active provider auto-selects remaining provider", async () => {
		const configWithProviders = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "provider-a",
				providers: [
					{ name: "provider-a", provider: "anthropic", model: "claude", apiKeyConfigured: true },
					{ name: "provider-b", provider: "openai", model: "gpt-4", apiKeyConfigured: true },
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProviders);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		expect(screen.getByTestId("provider-set-active-provider-a")).toHaveAccessibleName("Active provider");
		expect(screen.getByTestId("provider-set-active-provider-a")).toHaveTextContent("");

		const deleteBtn = screen.getByTestId("provider-delete-provider-a");
		fireEvent.click(deleteBtn);

		expect(screen.queryByText("provider-a")).not.toBeInTheDocument();
		expect(screen.getByTestId("provider-set-active-provider-b")).toHaveAccessibleName("Active provider");
		expect(screen.getByTestId("provider-set-active-provider-b")).toHaveTextContent("");
	});

	test("Duplicate provider name in editor shows error", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "existing",
				providers: [
					{ name: "existing", provider: "openai", model: "gpt-4", apiKeyConfigured: true },
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const addProviderBtn = screen.getByTestId("intelligence-add-provider-btn");
		fireEvent.click(addProviderBtn);

		const nameInput = screen.getByTestId("provider-editor-name-input") as HTMLInputElement;
		fireEvent.change(nameInput, { target: { value: "existing" } });
		const modelInput = screen.getByTestId("provider-editor-model-input") as HTMLInputElement;
		fireEvent.change(modelInput, { target: { value: "gpt-4" } });
		const apiKeyInput = screen.getByTestId("provider-editor-api-key-input") as HTMLInputElement;
		fireEvent.change(apiKeyInput, { target: { value: "sk-test" } });

		const saveBtn = screen.getByTestId("provider-editor-save-btn");
		fireEvent.click(saveBtn);

		const errorBanner = await screen.findByTestId("error-banner");
		expect(errorBanner.textContent).toMatch(/Provider name "existing" already exists/);
	});

	test("Missing name in editor shows validation error", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		const addProviderBtn = screen.getByTestId("intelligence-add-provider-btn");
		fireEvent.click(addProviderBtn);

		const saveBtn = screen.getByTestId("provider-editor-save-btn");
		fireEvent.click(saveBtn);

		await waitFor(() => {
			expect(screen.getByTestId("error-banner")).toBeInTheDocument();
		});
		expect(screen.getByText("Provider name is required")).toBeInTheDocument();
	});

	test("Missing model in editor shows validation error", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		const addProviderBtn = screen.getByTestId("intelligence-add-provider-btn");
		fireEvent.click(addProviderBtn);

		const nameInput = screen.getByTestId("provider-editor-name-input") as HTMLInputElement;
		fireEvent.change(nameInput, { target: { value: "my-provider" } });

		const saveBtn = screen.getByTestId("provider-editor-save-btn");
		fireEvent.click(saveBtn);

		await waitFor(() => {
			expect(screen.getByTestId("error-banner")).toBeInTheDocument();
		});
		expect(screen.getByText("Provider model is required")).toBeInTheDocument();
	});

	test("Missing API key for new provider shows validation error", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		const addProviderBtn = screen.getByTestId("intelligence-add-provider-btn");
		fireEvent.click(addProviderBtn);

		const nameInput = screen.getByTestId("provider-editor-name-input") as HTMLInputElement;
		fireEvent.change(nameInput, { target: { value: "my-provider" } });
		const modelInput = screen.getByTestId("provider-editor-model-input") as HTMLInputElement;
		fireEvent.change(modelInput, { target: { value: "gpt-4" } });

		const saveBtn = screen.getByTestId("provider-editor-save-btn");
		fireEvent.click(saveBtn);

		await waitFor(() => {
			expect(screen.getByTestId("error-banner")).toBeInTheDocument();
		});
		expect(screen.getByText("API key is required for new providers")).toBeInTheDocument();
	});

	test("Cancel button dismisses editor", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		const addProviderBtn = screen.getByTestId("intelligence-add-provider-btn");
		fireEvent.click(addProviderBtn);

		expect(screen.getByTestId("intelligence-provider-editor")).toBeInTheDocument();

		const cancelBtns = screen.getAllByRole("button", { name: /CANCEL/i });
		fireEvent.click(cancelBtns[0]!);

		expect(screen.queryByTestId("intelligence-provider-editor")).not.toBeInTheDocument();
	});

	test("Add multiple providers shows all in list", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		function addProvider(name: string, model: string, apiKey: string) {
			const addBtn = screen.getByTestId("intelligence-add-provider-btn");
			fireEvent.click(addBtn);
			fireEvent.change(screen.getByTestId("provider-editor-name-input"), { target: { value: name } });
			fireEvent.change(screen.getByTestId("provider-editor-model-input"), { target: { value: model } });
			fireEvent.change(screen.getByTestId("provider-editor-api-key-input"), { target: { value: apiKey } });
			fireEvent.click(screen.getByTestId("provider-editor-save-btn"));
		}

		addProvider("provider-a", "gpt-4", "key-a");
		addProvider("provider-b", "claude-3", "key-b");

		expect(screen.getByText("provider-a")).toBeInTheDocument();
		expect(screen.getByText("provider-b")).toBeInTheDocument();
		expect(screen.getByTestId("intelligence-providers-list").children).toHaveLength(2);
	});

	test("Save when intelligence is disabled succeeds", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);
		mockUpdateConfig.mockResolvedValue(defaultConfig);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const saveButton = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(mockUpdateConfig).toHaveBeenCalled();
		});

		const callArg = mockUpdateConfig.mock.calls[0]?.[0];
		expect(callArg?.intelligence?.enabled).toBe(false);
	});

	test("API error during save shows error banner", async () => {
		const { ApiError } = await import("../api/errors.js");
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);
		mockUpdateConfig.mockRejectedValue(new ApiError("internal_error", "something went wrong", 500));

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		const saveButton = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(screen.getByTestId("error-banner")).toBeInTheDocument();
		});
	});

	test("BaseURL field is optional and can be left blank", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);
		mockUpdateConfig.mockResolvedValue(defaultConfig);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		const addProviderBtn = screen.getByTestId("intelligence-add-provider-btn");
		fireEvent.click(addProviderBtn);

		fireEvent.change(screen.getByTestId("provider-editor-name-input"), { target: { value: "no-baseurl" } });
		fireEvent.change(screen.getByTestId("provider-editor-model-input"), { target: { value: "gpt-4" } });
		fireEvent.change(screen.getByTestId("provider-editor-api-key-input"), { target: { value: "key" } });

		fireEvent.click(screen.getByTestId("provider-editor-save-btn"));

		const setActiveBtn = screen.getByTestId("provider-set-active-no-baseurl");
		fireEvent.click(setActiveBtn);

		const saveBtn = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveBtn);

		await waitFor(() => {
			expect(mockUpdateConfig).toHaveBeenCalled();
		});
		const callArg = mockUpdateConfig.mock.calls[0]?.[0];
		expect(callArg?.intelligence?.providers[0]?.baseURL).toBeUndefined();
	});

	test("Active indicator is rendered for the active provider", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "my-provider",
				providers: [
					{ name: "my-provider", provider: "openai", model: "gpt-4", apiKeyConfigured: true },
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		expect(screen.getByTestId("provider-active-indicator-my-provider")).toBeInTheDocument();
	});

	test("apiKeyInput is empty when editing existing provider with configured key", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "my-provider",
				providers: [
					{
						name: "my-provider",
						provider: "openai",
						model: "gpt-4",
						apiKeyConfigured: true,
					},
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const editBtn = screen.getByTestId("provider-edit-my-provider");
		fireEvent.click(editBtn);

		await waitFor(() => {
			expect(screen.getByTestId("intelligence-provider-editor")).toBeInTheDocument();
		});

		const apiKeyInput = screen.getByTestId("provider-editor-api-key-input") as HTMLInputElement;
		expect(apiKeyInput.value).toBe("");
		expect(apiKeyInput.placeholder).toContain("leave blank to keep existing");
	});

	test("Password placeholder differs between new and existing providers", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "existing-prov",
				providers: [
					{ name: "existing-prov", provider: "openai", model: "gpt-4", apiKeyConfigured: true },
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const addProviderBtn = screen.getByTestId("intelligence-add-provider-btn");
		fireEvent.click(addProviderBtn);

		const newApiKeyInput = screen.getByTestId("provider-editor-api-key-input") as HTMLInputElement;
		expect(newApiKeyInput.placeholder).toBe("sk-...");
	});

	test("Global settings fields are disabled when intelligence is off", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		expect((screen.getByTestId("intelligence-max-bytes-input") as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByTestId("intelligence-timeout-sec-input") as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByTestId("intelligence-min-session-interval-sec-input") as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByTestId("intelligence-max-concurrency-input") as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByTestId("intelligence-cache-ttl-sec-input") as HTMLInputElement).disabled).toBe(true);
	});

	test("Empty state shown when no providers and no editor open", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		expect(screen.getByTestId("intelligence-providers-empty")).toBeInTheDocument();
	});

	test("SET ACTIVE button is disabled when intelligence is off", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: false,
				activeProvider: "",
				providers: [
					{ name: "idle-provider", provider: "openai", model: "gpt-4", apiKeyConfigured: true },
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		expect((screen.getByTestId("provider-set-active-idle-provider") as HTMLButtonElement).disabled).toBe(true);
	});

	test("Edit and delete buttons are disabled when intelligence is off", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: false,
				providers: [
					{ name: "frozen", provider: "openai", model: "gpt-4", apiKeyConfigured: true },
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		expect((screen.getByTestId("provider-edit-frozen") as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByTestId("provider-delete-frozen") as HTMLButtonElement).disabled).toBe(true);
	});

	test("Active provider card has is-active class", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "active-one",
				providers: [
					{ name: "active-one", provider: "openai", model: "gpt-4", apiKeyConfigured: true },
					{ name: "inactive", provider: "anthropic", model: "claude", apiKeyConfigured: true },
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		expect(screen.getByTestId("intelligence-provider-card-active-one").className).toContain("is-active");
		expect(screen.getByTestId("intelligence-provider-card-inactive").className).not.toContain("is-active");
	});

	test("Save validates active provider exists in provider list", async () => {
		const configWithProvider = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "stale-provider",
				providers: [
					{ name: "actual-provider", provider: "openai", model: "gpt-4", apiKeyConfigured: true },
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProvider);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const saveBtn = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveBtn);

		await waitFor(() => {
			expect(mockUpdateConfig).not.toHaveBeenCalled();
		});
		expect(screen.getByTestId("error-banner")).toBeInTheDocument();
		expect(screen.getByText("Selected active provider does not exist")).toBeInTheDocument();
	});

	test("Save validates all providers have a name", async () => {
		const partialConfig = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "ok",
				providers: [
					{ name: "ok", provider: "openai", model: "gpt-4", apiKeyConfigured: true },
					{ name: "", provider: "anthropic", model: "claude", apiKeyConfigured: true },
				],
			},
		};
		mockGetConfig.mockResolvedValue(partialConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const saveBtn = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveBtn);

		await waitFor(() => {
			expect(screen.getByTestId("error-banner")).toBeInTheDocument();
		});
		expect(screen.getByText("All providers must have a name")).toBeInTheDocument();
	});

	test("Save validates all providers have a provider type", async () => {
		const partialConfig = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "ok",
				providers: [
					{ name: "ok", provider: "openai", model: "gpt-4", apiKeyConfigured: true },
					{ name: "no-type", provider: "", model: "claude", apiKeyConfigured: true },
				],
			},
		};
		mockGetConfig.mockResolvedValue(partialConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const saveBtn = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveBtn);

		await waitFor(() => {
			expect(screen.getByTestId("error-banner")).toBeInTheDocument();
		});
		expect(screen.getByText("All providers must have a provider type")).toBeInTheDocument();
	});

	test("Save validates all providers have a model", async () => {
		const partialConfig = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "ok",
				providers: [
					{ name: "ok", provider: "openai", model: "gpt-4", apiKeyConfigured: true },
					{ name: "no-model", provider: "anthropic", model: "", apiKeyConfigured: true },
				],
			},
		};
		mockGetConfig.mockResolvedValue(partialConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
				<ErrorBanner />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const saveBtn = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveBtn);

		await waitFor(() => {
			expect(screen.getByTestId("error-banner")).toBeInTheDocument();
		});
		expect(screen.getByText("All providers must have a model")).toBeInTheDocument();
	});

	test("Set active provider updates activeProvider state", async () => {
		const configWithProviders = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				activeProvider: "provider-a",
				providers: [
					{
						name: "provider-a",
						provider: "anthropic",
						model: "claude-sonnet-4",
						apiKeyConfigured: true,
					},
					{
						name: "provider-b",
						provider: "openai",
						model: "gpt-4o",
						apiKeyConfigured: true,
					},
				],
			},
		};
		mockGetConfig.mockResolvedValue(configWithProviders);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		navigateToIntelligenceTab();

		const setActiveBtn = screen.getByTestId("provider-set-active-provider-b");
		fireEvent.click(setActiveBtn);

		expect(screen.getByTestId("provider-set-active-provider-b")).toHaveAccessibleName("Active provider");
		expect(screen.getByTestId("provider-set-active-provider-b")).toHaveTextContent("");
		expect(screen.getByTestId("provider-set-active-provider-a")).toHaveAccessibleName("Set provider-a as active provider");
		expect(screen.getByTestId("provider-set-active-provider-a")).toHaveTextContent("");
	});
});

describe("SettingsPanel uiScaleStep", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("Typography tab renders step controls", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		expect(screen.getByTestId("settings-scale-decrease")).toBeInTheDocument();
		expect(screen.getByTestId("settings-scale-increase")).toBeInTheDocument();
		expect(screen.getByTestId("settings-scale-reset")).toBeInTheDocument();
		expect(screen.getByTestId("settings-scale-value")).toBeInTheDocument();
		expect(screen.getByTestId("settings-terminal-font-weight-input")).toBeInTheDocument();
	});

	test("Save payload includes uiScaleStep", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);
		mockUpdateConfig.mockResolvedValue(defaultConfig);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		const increaseBtn = screen.getByTestId("settings-scale-increase");
		fireEvent.click(increaseBtn);
		fireEvent.click(increaseBtn);

		const saveButton = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(mockUpdateConfig).toHaveBeenCalled();
		});

		const callArg = mockUpdateConfig.mock.calls[0]?.[0];
		expect(callArg?.ui?.uiScaleStep).toBe(2);
	});

	test("terminalFontWeight remains present in payload", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);
		mockUpdateConfig.mockResolvedValue(defaultConfig);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		const weightSelect = screen.getByTestId("settings-terminal-font-weight-input") as HTMLSelectElement;
		fireEvent.change(weightSelect, { target: { value: "bold" } });

		const saveButton = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(mockUpdateConfig).toHaveBeenCalled();
		});

		const callArg = mockUpdateConfig.mock.calls[0]?.[0];
		expect(callArg?.ui?.terminalFontWeight).toBe("bold");
	});

	test("Loads uiScaleStep from config", async () => {
		const configWithScaleStep = {
			...defaultConfig,
			ui: {
				...defaultConfig.ui,
				uiScaleStep: 3,
			},
		};
		mockGetConfig.mockResolvedValue(configWithScaleStep);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		const valueLabel = screen.getByTestId("settings-scale-value");
		expect(valueLabel).toHaveTextContent("+3");
	});

	test("Migrates legacy fontSize to uiScaleStep in form state", async () => {
		const legacyConfig = {
			...defaultConfig,
			ui: {
				theme: "dark",
				windowTheme: "dark",
				fontSize: 18,
				terminalFontSize: 14,
				terminalFontWeight: "normal",
			},
		};
		mockGetConfig.mockResolvedValue(legacyConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		const valueLabel = screen.getByTestId("settings-scale-value");
		expect(valueLabel).toHaveTextContent("+3");
	});

	test("Clamps fontSize 20 to uiScaleStep 4", async () => {
		const legacyConfig = {
			...defaultConfig,
			ui: {
				theme: "dark",
				windowTheme: "dark",
				fontSize: 20,
				terminalFontSize: 14,
				terminalFontWeight: "normal",
			},
		};
		mockGetConfig.mockResolvedValue(legacyConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		const valueLabel = screen.getByTestId("settings-scale-value");
		expect(valueLabel).toHaveTextContent("+4");
	});

	test("Decrease button disabled at step -4", async () => {
		const configAtMin = {
			...defaultConfig,
			ui: {
				...defaultConfig.ui,
				uiScaleStep: -4,
			},
		};
		mockGetConfig.mockResolvedValue(configAtMin);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		const decreaseBtn = screen.getByTestId("settings-scale-decrease") as HTMLButtonElement;
		expect(decreaseBtn.disabled).toBe(true);
		const increaseBtn = screen.getByTestId("settings-scale-increase") as HTMLButtonElement;
		expect(increaseBtn.disabled).toBe(false);
	});

	test("Increase button disabled at step +4", async () => {
		const configAtMax = {
			...defaultConfig,
			ui: {
				...defaultConfig.ui,
				uiScaleStep: 4,
			},
		};
		mockGetConfig.mockResolvedValue(configAtMax);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		const increaseBtn = screen.getByTestId("settings-scale-increase") as HTMLButtonElement;
		expect(increaseBtn.disabled).toBe(true);
		const decreaseBtn = screen.getByTestId("settings-scale-decrease") as HTMLButtonElement;
		expect(decreaseBtn.disabled).toBe(false);
	});

	test("Reset button sets step to 0", async () => {
		const configAtMax = {
			...defaultConfig,
			ui: {
				...defaultConfig.ui,
				uiScaleStep: 3,
			},
		};
		mockGetConfig.mockResolvedValue(configAtMax);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		const valueLabel = screen.getByTestId("settings-scale-value");
		expect(valueLabel).toHaveTextContent("+3");

		const resetBtn = screen.getByTestId("settings-scale-reset");
		fireEvent.click(resetBtn);

		expect(valueLabel).toHaveTextContent("0");
	});

	test("Increase and decrease buttons respect boundaries", async () => {
		mockGetConfig.mockResolvedValue(defaultConfig);
		mockListConnectionHealth.mockResolvedValue([]);

		render(
			<TestWrapper>
				{enableSettingsPanel()}
				<SettingsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Typography/i }));

		const decreaseBtn = screen.getByTestId("settings-scale-decrease");
		const increaseBtn = screen.getByTestId("settings-scale-increase");
		const valueLabel = screen.getByTestId("settings-scale-value");

		expect(valueLabel).toHaveTextContent("0");

		fireEvent.click(decreaseBtn);
		fireEvent.click(decreaseBtn);
		expect(valueLabel).toHaveTextContent("-2");

		fireEvent.click(increaseBtn);
		expect(valueLabel).toHaveTextContent("-1");
	});
});

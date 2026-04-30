import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel.js";
import { AppProvider, useAppState } from "../state/store.js";
import * as client from "../api/client.js";

vi.mock("../api/client.js", () => ({
	getConfig: vi.fn(),
	updateConfig: vi.fn(),
	deleteConnection: vi.fn(),
	listConnectionHealth: vi.fn(),
	connectionDisplayName: vi.fn((conn: { type: string; host?: string; id: string }) => {
		if (conn.type === "local") return "local";
		return conn.host ?? conn.id;
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
		setShowSettingsPanel(true);
		return null;
	}
	return <Opener />;
}

const defaultConfig = {
	schemaVersion: 1,
	server: { bind: "127.0.0.1:7331" },
	auth: { token: "", tokenConfigured: false },
	tmux: { path: "tmux" },
	connections: [{ id: "conn1", type: "local" }],
	ui: { theme: "dark", fontSize: 16, terminalFontSize: 14, terminalFontWeight: "normal" },
	intelligence: {
		enabled: false,
		provider: "anthropic",
		model: "claude-sonnet-4-20250514",
		envKeyRef: "ANTHROPIC_API_KEY",
		baseURL: "",
		maxBytes: 4096,
		timeoutSec: 30,
		minSessionIntervalSec: 60,
		maxConcurrency: 3,
		cacheTTLSec: 300,
	},
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

		expect(screen.getByText("AI Intelligence")).toBeInTheDocument();
	});

	test("When intelligence.enabled is false provider/model/envKeyRef inputs are disabled", async () => {
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

		const providerSelect = screen.getByTestId("intelligence-provider-select") as HTMLSelectElement;
		const modelInput = screen.getByTestId("intelligence-model-input") as HTMLInputElement;
		const envKeyRefInput = screen.getByTestId("intelligence-env-key-ref-input") as HTMLInputElement;

		expect(providerSelect.disabled).toBe(true);
		expect(modelInput.disabled).toBe(true);
		expect(envKeyRefInput.disabled).toBe(true);
	});

	test("When intelligence enabled toggle is turned on provider/model/envKeyRef inputs become enabled", async () => {
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

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		const providerSelect = screen.getByTestId("intelligence-provider-select") as HTMLSelectElement;
		const modelInput = screen.getByTestId("intelligence-model-input") as HTMLInputElement;
		const envKeyRefInput = screen.getByTestId("intelligence-env-key-ref-input") as HTMLInputElement;

		expect(providerSelect.disabled).toBe(false);
		expect(modelInput.disabled).toBe(false);
		expect(envKeyRefInput.disabled).toBe(false);
	});

	test("Save payload includes intelligence object with all fields from form", async () => {
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

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		fireEvent.click(enableToggle);

		const modelInput = screen.getByTestId("intelligence-model-input") as HTMLInputElement;
		fireEvent.change(modelInput, { target: { value: "gpt-4" } });

		const saveButton = screen.getByRole("button", { name: /SAVE/i });
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(mockUpdateConfig).toHaveBeenCalled();
		});

		const callArg = mockUpdateConfig.mock.calls[0]?.[0];
		expect(callArg).toBeDefined();
		expect(callArg?.intelligence?.enabled).toBe(true);
		expect(callArg?.intelligence?.model).toBe("gpt-4");
		expect(callArg?.intelligence?.provider).toBe("anthropic");
	});

	test("Intelligence form fields load from existing config values", async () => {
		const configWithIntelligence = {
			...defaultConfig,
			intelligence: {
				...defaultConfig.intelligence,
				enabled: true,
				provider: "openai",
				model: "gpt-4o",
				envKeyRef: "OPENAI_API_KEY",
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

		const enableToggle = screen.getByTestId("intelligence-enabled-checkbox") as HTMLInputElement;
		expect(enableToggle.checked).toBe(true);

		const providerSelect = screen.getByTestId("intelligence-provider-select") as HTMLSelectElement;
		expect(providerSelect.value).toBe("openai");

		const modelInput = screen.getByTestId("intelligence-model-input") as HTMLInputElement;
		expect(modelInput.value).toBe("gpt-4o");

		const envKeyRefInput = screen.getByTestId("intelligence-env-key-ref-input") as HTMLInputElement;
		expect(envKeyRefInput.value).toBe("OPENAI_API_KEY");
	});
});

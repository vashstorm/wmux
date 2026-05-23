import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { ProjectDashboard } from "./ProjectDashboard.js";
import { AppProvider, useAppState } from "../state/store.js";
import type { Project } from "../api/client.js";
import * as client from "../api/client.js";

vi.mock("../api/client.js", () => ({
	launchProject: vi.fn(),
	syncProjectFromTmux: vi.fn(),
	generateProjectAiHtml: vi.fn(),
	getProject: vi.fn(),
}));

const mockLaunchProject = vi.mocked(client.launchProject);
const mockSyncProjectFromTmux = vi.mocked(client.syncProjectFromTmux);
const mockGenerateProjectAiHtml = vi.mocked(client.generateProjectAiHtml);
const mockGetProject = vi.mocked(client.getProject);

function TestWrapper({ children }: { children: React.ReactNode }) {
	return <AppProvider>{children}</AppProvider>;
}

function enableProject(project: Project | null) {
	function Opener() {
		const { setSelectedProject } = useAppState();
		useEffect(() => {
			setSelectedProject(project);
		}, [project, setSelectedProject]);
		return null;
	}
	return <Opener />;
}

function makeProject(overrides: Partial<Project> = {}): Project {
	return {
		id: "proj-1",
		name: "Test Project",
		path: "/tmp/test",
		description: "A test project",
		createdAt: "2025-01-01T00:00:00Z",
		updatedAt: "2025-01-01T00:00:00Z",
		sessionName: "my-session",
		status: "idle",
		workdir: "/tmp/test",
		layoutJson: "{}",
		detailsJson: "{}",
		progressJson: "{}",
		aiHtml: "",
		aiStatus: "idle",
		aiError: "",
		lastSyncedAt: null,
		schemaVersion: 1,
		...overrides,
	};
}

describe("ProjectDashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("renders null when no project selected", () => {
		const { container } = render(
			<TestWrapper>
				{enableProject(null)}
				<ProjectDashboard />
			</TestWrapper>,
		);
		expect(container.innerHTML).toBe("");
	});

	test("renders project name and title", () => {
		render(
			<TestWrapper>
				{enableProject(makeProject())}
				<ProjectDashboard />
			</TestWrapper>,
		);
		expect(screen.getByTestId("project-dashboard-title")).toHaveTextContent("Test Project");
	});

	test("renders all action buttons", () => {
		render(
			<TestWrapper>
				{enableProject(makeProject())}
				<ProjectDashboard />
			</TestWrapper>,
		);
		expect(screen.getByTestId("project-launch-button")).toBeInTheDocument();
		expect(screen.getByTestId("project-sync-button")).toBeInTheDocument();
		expect(screen.getByTestId("project-ai-generate-button")).toBeInTheDocument();
	});

	test("displays project metadata", () => {
		render(
			<TestWrapper>
				{enableProject(makeProject({
					name: "My Project",
					sessionName: "dev-session",
					status: "running",
					workdir: "/Users/dev/project",
					description: "Test description",
				}))}
				<ProjectDashboard />
			</TestWrapper>,
		);
		expect(screen.getByTestId("project-dashboard-title")).toHaveTextContent("My Project");
		expect(screen.getByText("dev-session")).toBeInTheDocument();
		expect(screen.queryAllByText("running")).toHaveLength(2);
		expect(screen.getByText("/Users/dev/project")).toBeInTheDocument();
		expect(screen.getByText("Test description")).toBeInTheDocument();
	});

	test("launch button calls launchProject API and navigates to session", async () => {
		const updatedProject = makeProject({ status: "running" });
		mockLaunchProject.mockResolvedValue({ project: updatedProject, operation: "launch" });
		mockGetProject.mockResolvedValue(updatedProject);

		function SelectedProjectChecker() {
			const { selectedProject } = useAppState();
			return <span data-testid="selected-project-state">{selectedProject ? selectedProject.name : "no-project"}</span>;
		}

		render(
			<TestWrapper>
				{enableProject(makeProject())}
				<ProjectDashboard />
				<SelectedProjectChecker />
			</TestWrapper>,
		);

		expect(screen.getByTestId("selected-project-state")).toHaveTextContent("Test Project");

		fireEvent.click(screen.getByTestId("project-launch-button"));

		await waitFor(() => {
			expect(mockLaunchProject).toHaveBeenCalledWith("proj-1");
		});

		await waitFor(() => {
			expect(screen.getByTestId("selected-project-state")).toHaveTextContent("no-project");
		});
	});

	test("sync button calls syncProjectFromTmux API", async () => {
		const updatedProject = makeProject({ lastSyncedAt: "2025-01-01T00:00:00Z" });
		mockSyncProjectFromTmux.mockResolvedValue({ project: updatedProject, operation: "sync" });
		mockGetProject.mockResolvedValue(updatedProject);

		render(
			<TestWrapper>
				{enableProject(makeProject())}
				<ProjectDashboard />
			</TestWrapper>,
		);

		fireEvent.click(screen.getByTestId("project-sync-button"));

		await waitFor(() => {
			expect(mockSyncProjectFromTmux).toHaveBeenCalledWith("proj-1");
		});
	});

	test("ai generate button calls generateProjectAiHtml API", async () => {
		const updatedProject = makeProject({ aiHtml: "<p>Generated</p>", aiStatus: "done" });
		mockGenerateProjectAiHtml.mockResolvedValue(updatedProject);
		mockGetProject.mockResolvedValue(updatedProject);

		render(
			<TestWrapper>
				{enableProject(makeProject())}
				<ProjectDashboard />
			</TestWrapper>,
		);

		fireEvent.click(screen.getByTestId("project-ai-generate-button"));

		await waitFor(() => {
			expect(mockGenerateProjectAiHtml).toHaveBeenCalledWith("proj-1");
		});
	});

	test("shows AI HTML via SafeHtml when aiStatus is done", () => {
		render(
			<TestWrapper>
				{enableProject(makeProject({
					aiHtml: "<p>Generated <strong>content</strong></p>",
					aiStatus: "done",
				}))}
				<ProjectDashboard />
			</TestWrapper>,
		);
		const aiHtmlEl = screen.getByTestId("project-ai-html");
		expect(aiHtmlEl).toBeInTheDocument();
		expect(screen.getByText("Generated")).toBeInTheDocument();
	});

	test("shows loading state when aiStatus is generating", () => {
		render(
			<TestWrapper>
				{enableProject(makeProject({ aiStatus: "generating" }))}
				<ProjectDashboard />
			</TestWrapper>,
		);
		expect(screen.queryByTestId("project-ai-html")).toBeNull();
		expect(screen.getByText("Generating AI content...")).toBeInTheDocument();
	});

	test("shows error state when aiStatus is error with aiError", () => {
		render(
			<TestWrapper>
				{enableProject(makeProject({
					aiStatus: "error",
					aiError: "API key missing",
				}))}
				<ProjectDashboard />
			</TestWrapper>,
		);
		expect(screen.queryByTestId("project-ai-html")).toBeNull();
		expect(screen.getByText("API key missing")).toBeInTheDocument();
	});

	test("shows empty state when no aiHtml and aiStatus is idle", () => {
		render(
			<TestWrapper>
				{enableProject(makeProject({ aiStatus: "idle", aiHtml: "" }))}
				<ProjectDashboard />
			</TestWrapper>,
		);
		expect(screen.queryByTestId("project-ai-html")).toBeNull();
		expect(screen.getByText(/No AI-generated content yet/)).toBeInTheDocument();
	});

	test("API error on launch shows error message", async () => {
		const { ApiError } = await import("../api/errors.js");
		mockLaunchProject.mockRejectedValue(new ApiError("bad_request", "Session conflict", 409));

		render(
			<TestWrapper>
				{enableProject(makeProject())}
				<ProjectDashboard />
			</TestWrapper>,
		);

		fireEvent.click(screen.getByTestId("project-launch-button"));

		await waitFor(() => {
			expect(screen.getByText("Session conflict")).toBeInTheDocument();
		});
	});

	test("action buttons disabled while another action is loading", async () => {
		const neverResolve = new Promise(() => {});
		mockLaunchProject.mockReturnValue(neverResolve as never);

		render(
			<TestWrapper>
				{enableProject(makeProject())}
				<ProjectDashboard />
			</TestWrapper>,
		);

		fireEvent.click(screen.getByTestId("project-launch-button"));

		await waitFor(() => {
			expect((screen.getByTestId("project-sync-button") as HTMLButtonElement).disabled).toBe(true);
			expect((screen.getByTestId("project-ai-generate-button") as HTMLButtonElement).disabled).toBe(true);
		});
	});

	test("script tags are not rendered from aiHtml", () => {
		render(
			<TestWrapper>
				{enableProject(makeProject({
					aiHtml: "<script>alert('xss')</script><p>safe</p>",
					aiStatus: "done",
				}))}
				<ProjectDashboard />
			</TestWrapper>,
		);
		expect(document.querySelector("script")).toBeNull();
		expect(screen.getByText("safe")).toBeInTheDocument();
	});

	test("onclick attributes are not rendered from aiHtml", () => {
		render(
			<TestWrapper>
				{enableProject(makeProject({
					aiHtml: '<button onclick="alert(1)">click</button>',
					aiStatus: "done",
				}))}
				<ProjectDashboard />
			</TestWrapper>,
		);
		const btn = screen.getByText("click");
		expect(btn).not.toHaveAttribute("onclick");
	});

	test("javascript: URLs are not rendered from aiHtml", () => {
		render(
			<TestWrapper>
				{enableProject(makeProject({
					aiHtml: '<a href="javascript:alert(1)">evil</a>',
					aiStatus: "done",
				}))}
				<ProjectDashboard />
			</TestWrapper>,
		);
		const link = screen.getByText("evil");
		const href = link.getAttribute("href");
		expect(href).toBeFalsy();
	});

	test("displays layout summary when layoutJson contains windows", () => {
		render(
			<TestWrapper>
				{enableProject(makeProject({
					layoutJson: JSON.stringify({ windows: [{ id: "1" }, { id: "2" }] }),
				}))}
				<ProjectDashboard />
			</TestWrapper>,
		);
		expect(screen.getByText("2 windows")).toBeInTheDocument();
	});

	test("displays status chip with correct color", () => {
		const { container } = render(
			<TestWrapper>
				{enableProject(makeProject({ status: "running" }))}
				<ProjectDashboard />
			</TestWrapper>,
		);
		const chip = container.querySelector(".MuiChip-colorSuccess")!;
		expect(chip).toBeInTheDocument();
		expect(chip).toHaveTextContent("running");
	});
});

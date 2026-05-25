import type { SelectedPane } from "../state/store.js";
import {
	parseWorkspaceUrl,
	formatWorkspaceUrl,
	toSelectedPane,
	fromSelectedPane,
	getWorkspaceHistoryAction,
	isStructurallyValidWorkspaceLocation,
	type WorkspaceLocation,
} from "./workspaceUrl.js";

describe("parseWorkspaceUrl", () => {
	test("parses valid inputs and decodes URL-encoded values", () => {
		expect(parseWorkspaceUrl("?connection=local&session=wmux")).toEqual({
			connection: "local",
			session: "wmux",
		});
		expect(parseWorkspaceUrl("?connection=local&session=wmux&window=%401")).toEqual({
			connection: "local",
			session: "wmux",
			window: "@1",
		});
		expect(parseWorkspaceUrl("?connection=local&session=wmux&window=%401&pane=%251")).toEqual({
			connection: "local",
			session: "wmux",
			window: "@1",
			pane: "%1",
		});
		expect(parseWorkspaceUrl("?connection=local&session=my%20session%23name")).toEqual({
			connection: "local",
			session: "my session#name",
		});
	});

	test("returns null for invalid or empty inputs", () => {
		expect(parseWorkspaceUrl("")).toBeNull();
		expect(parseWorkspaceUrl("?")).toBeNull();
		expect(parseWorkspaceUrl("?session=wmux")).toBeNull();
		expect(parseWorkspaceUrl("?connection=local")).toBeNull();
		expect(parseWorkspaceUrl("?connection=local&session=wmux&pane=%251")).toBeNull();
		expect(parseWorkspaceUrl("?connection=&session=wmux")).toBeNull();
		expect(parseWorkspaceUrl("?connection=local&session=")).toBeNull();
	});

	test("handles extra params and optional leading ?", () => {
		expect(parseWorkspaceUrl("?connection=local&session=wmux&extra=ignored")).toEqual({
			connection: "local",
			session: "wmux",
		});
		expect(parseWorkspaceUrl("connection=local&session=wmux")).toEqual({
			connection: "local",
			session: "wmux",
		});
	});
});

describe("formatWorkspaceUrl", () => {
	test("formats valid locations and encodes special characters", () => {
		expect(formatWorkspaceUrl({ connection: "local", session: "wmux" })).toBe("?connection=local&session=wmux");
		expect(formatWorkspaceUrl({ connection: "local", session: "wmux", window: "@1" })).toBe("?connection=local&session=wmux&window=%401");
		expect(formatWorkspaceUrl({ connection: "local", session: "wmux", window: "@1", pane: "%1" })).toBe("?connection=local&session=wmux&window=%401&pane=%251");
		expect(formatWorkspaceUrl({ connection: "local", session: "my session#name" })).toBe("?connection=local&session=my+session%23name");
	});

	test("returns empty string for null or incomplete locations", () => {
		expect(formatWorkspaceUrl(null)).toBe("");
		expect(formatWorkspaceUrl({ connection: "local" } as WorkspaceLocation)).toBe("");
		expect(formatWorkspaceUrl({ session: "wmux" } as WorkspaceLocation)).toBe("");
	});
});

describe("round-trip: formatWorkspaceUrl -> parseWorkspaceUrl", () => {
	test("preserves locations through format and parse", () => {
		const cases: WorkspaceLocation[] = [
			{ connection: "local", session: "wmux" },
			{ connection: "local", session: "wmux", window: "@1", pane: "%1" },
			{ connection: "local", session: "my session name" },
			{ connection: "local", session: "session#name" },
		];
		for (const original of cases) {
			expect(parseWorkspaceUrl(formatWorkspaceUrl(original))).toEqual(original);
		}
	});
});

describe("toSelectedPane", () => {
	test("maps WorkspaceLocation fields correctly", () => {
		expect(toSelectedPane({ connection: "my-connection", session: "wmux" })).toEqual({
			targetName: "my-connection",
			session: "wmux",
		});
		expect(toSelectedPane({ connection: "conn1", session: "sess1", window: "@5", pane: "%10" })).toEqual({
			targetName: "conn1",
			session: "sess1",
			window: "@5",
			pane: "%10",
		});
	});
});

describe("fromSelectedPane", () => {
	test("maps SelectedPane fields correctly", () => {
		expect(fromSelectedPane({ targetName: "my-connection", session: "wmux" })).toEqual({
			connection: "my-connection",
			session: "wmux",
		});
		expect(fromSelectedPane({ targetName: "conn1", session: "sess1", window: "@5", pane: "%10" })).toEqual({
			connection: "conn1",
			session: "sess1",
			window: "@5",
			pane: "%10",
		});
	});

	test("returns null for null input", () => {
		expect(fromSelectedPane(null)).toBeNull();
	});
});

describe("getWorkspaceHistoryAction", () => {
	test("returns push for navigation changes", () => {
		const next: SelectedPane = { targetName: "local", session: "wmux" };
		expect(getWorkspaceHistoryAction(null, next)).toBe("push");

		const a: SelectedPane = { targetName: "local", session: "session1" };
		const b: SelectedPane = { targetName: "local", session: "session2" };
		expect(getWorkspaceHistoryAction(a, b)).toBe("push");

		const c: SelectedPane = { targetName: "conn1", session: "session1" };
		const d: SelectedPane = { targetName: "conn2", session: "session1" };
		expect(getWorkspaceHistoryAction(c, d)).toBe("push");

		const e: SelectedPane = { targetName: "local", session: "wmux", window: "@1" };
		const f: SelectedPane = { targetName: "local", session: "wmux", window: "@2" };
		expect(getWorkspaceHistoryAction(e, f)).toBe("push");

		const g: SelectedPane = { targetName: "local", session: "wmux" };
		const h: SelectedPane = { targetName: "local", session: "wmux", window: "@1" };
		expect(getWorkspaceHistoryAction(g, h)).toBe("push");

		const i: SelectedPane = { targetName: "local", session: "wmux", window: "@1" };
		const j: SelectedPane = { targetName: "local", session: "wmux" };
		expect(getWorkspaceHistoryAction(i, j)).toBe("push");
	});

	test("returns replace for null or same-session pane changes", () => {
		const prev: SelectedPane = { targetName: "local", session: "wmux" };
		expect(getWorkspaceHistoryAction(prev, null)).toBe("replace");
		expect(getWorkspaceHistoryAction(null, null)).toBe("replace");

		const a: SelectedPane = { targetName: "local", session: "wmux", window: "@1", pane: "%1" };
		const b: SelectedPane = { targetName: "local", session: "wmux", window: "@1", pane: "%2" };
		expect(getWorkspaceHistoryAction(a, b)).toBe("replace");

		const c: SelectedPane = { targetName: "local", session: "wmux", window: "@1" };
		const d: SelectedPane = { targetName: "local", session: "wmux", window: "@1", pane: "%1" };
		expect(getWorkspaceHistoryAction(c, d)).toBe("replace");

		const e: SelectedPane = { targetName: "local", session: "wmux", window: "@1", pane: "%1" };
		const f: SelectedPane = { targetName: "local", session: "wmux", window: "@1" };
		expect(getWorkspaceHistoryAction(e, f)).toBe("replace");

		expect(getWorkspaceHistoryAction(a, a)).toBe("replace");
	});
});

describe("isStructurallyValidWorkspaceLocation", () => {
	test("accepts valid locations", () => {
		expect(isStructurallyValidWorkspaceLocation({ connection: "local", session: "wmux" })).toBe(true);
		expect(isStructurallyValidWorkspaceLocation({ connection: "local", session: "wmux", window: "@1" })).toBe(true);
		expect(isStructurallyValidWorkspaceLocation({ connection: "local", session: "wmux", window: "@1", pane: "%1" })).toBe(true);
	});

	test("rejects incomplete or malformed locations", () => {
		expect(isStructurallyValidWorkspaceLocation({ session: "wmux" } as WorkspaceLocation)).toBe(false);
		expect(isStructurallyValidWorkspaceLocation({ connection: "local" } as WorkspaceLocation)).toBe(false);
		expect(isStructurallyValidWorkspaceLocation({ connection: "", session: "wmux" })).toBe(false);
		expect(isStructurallyValidWorkspaceLocation({ connection: "local", session: "" })).toBe(false);
		expect(isStructurallyValidWorkspaceLocation({ connection: "local", session: "wmux", pane: "%1" } as WorkspaceLocation)).toBe(false);
	});
});

describe("acceptance criteria", () => {
	test("covers key URL behaviors", () => {
		expect(parseWorkspaceUrl("?connection=local&session=wmux&window=%401&pane=%251")).toEqual({
			connection: "local",
			session: "wmux",
			window: "@1",
			pane: "%1",
		});
		expect(parseWorkspaceUrl("?connection=local&session=wmux&pane=%251")).toBeNull();
		expect(formatWorkspaceUrl(null)).toBe("");
		expect(formatWorkspaceUrl({ connection: "local" } as WorkspaceLocation)).toBe("");
	});
});

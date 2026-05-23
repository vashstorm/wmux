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
	describe("valid inputs", () => {
		test("parses connection and session", () => {
			const result = parseWorkspaceUrl("?connection=local&session=wmux");
			expect(result).toEqual({
				connection: "local",
				session: "wmux",
			});
		});

		test("parses connection, session, and window", () => {
			const result = parseWorkspaceUrl("?connection=local&session=wmux&window=%401");
			expect(result).toEqual({
				connection: "local",
				session: "wmux",
				window: "@1",
			});
		});

		test("parses full location with all fields", () => {
			const result = parseWorkspaceUrl("?connection=local&session=wmux&window=%401&pane=%251");
			expect(result).toEqual({
				connection: "local",
				session: "wmux",
				window: "@1",
				pane: "%1",
			});
		});

		test("decodes URL-encoded values", () => {
			const result = parseWorkspaceUrl("?connection=local&session=my%20session%23name");
			expect(result).toEqual({
				connection: "local",
				session: "my session#name",
			});
		});

		test("handles special characters: @ and %", () => {
			const result = parseWorkspaceUrl("?connection=local&session=wmux&window=%401&pane=%251");
			expect(result?.window).toBe("@1");
			expect(result?.pane).toBe("%1");
		});

		test("handles session names with spaces", () => {
			const result = parseWorkspaceUrl("?connection=local&session=my%20session");
			expect(result).toEqual({
				connection: "local",
				session: "my session",
			});
		});

		test("handles session names with #", () => {
			const result = parseWorkspaceUrl("?connection=local&session=session%23name");
			expect(result).toEqual({
				connection: "local",
				session: "session#name",
			});
		});
	});

	describe("invalid inputs returning null", () => {
		test("returns null for empty search string", () => {
			expect(parseWorkspaceUrl("")).toBeNull();
		});

		test("returns null for search with only ?", () => {
			expect(parseWorkspaceUrl("?")).toBeNull();
		});

		test("returns null when connection is missing", () => {
			expect(parseWorkspaceUrl("?session=wmux")).toBeNull();
		});

		test("returns null when session is missing", () => {
			expect(parseWorkspaceUrl("?connection=local")).toBeNull();
		});

		test("returns null when pane is present without window", () => {
			expect(parseWorkspaceUrl("?connection=local&session=wmux&pane=%251")).toBeNull();
		});

		test("window without pane is valid", () => {
			const result = parseWorkspaceUrl("?connection=local&session=wmux&window=%401");
			expect(result).toEqual({
				connection: "local",
				session: "wmux",
				window: "@1",
			});
		});

		test("returns null for empty connection", () => {
			expect(parseWorkspaceUrl("?connection=&session=wmux")).toBeNull();
		});

		test("returns null for empty session", () => {
			expect(parseWorkspaceUrl("?connection=local&session=")).toBeNull();
		});
	});

	describe("edge cases", () => {
		test("handles extra query parameters (ignores them)", () => {
			const result = parseWorkspaceUrl("?connection=local&session=wmux&extra=ignored");
			expect(result).toEqual({
				connection: "local",
				session: "wmux",
			});
		});

		test("handles leading ? correctly", () => {
			const result = parseWorkspaceUrl("?connection=local&session=wmux");
			expect(result).not.toBeNull();
		});

		test("handles no leading ? (just key=value string)", () => {
			const result = parseWorkspaceUrl("connection=local&session=wmux");
			expect(result).not.toBeNull();
		});
	});
});

describe("formatWorkspaceUrl", () => {
	describe("valid locations", () => {
		test("formats connection and session", () => {
			const result = formatWorkspaceUrl({ connection: "local", session: "wmux" });
			expect(result).toBe("?connection=local&session=wmux");
		});

		test("formats connection, session, and window", () => {
			const result = formatWorkspaceUrl({
				connection: "local",
				session: "wmux",
				window: "@1",
			});
			expect(result).toBe("?connection=local&session=wmux&window=%401");
		});

		test("formats full location with pane", () => {
			const result = formatWorkspaceUrl({
				connection: "local",
				session: "wmux",
				window: "@1",
				pane: "%1",
			});
			expect(result).toBe("?connection=local&session=wmux&window=%401&pane=%251");
		});

		test("URL-encodes special characters", () => {
			const result = formatWorkspaceUrl({
				connection: "local",
				session: "my session#name",
			});
			// URLSearchParams encodes space as + (valid, equivalent to %20)
			expect(result).toBe("?connection=local&session=my+session%23name");
		});

		test("encodes @ in window ID", () => {
			const result = formatWorkspaceUrl({
				connection: "local",
				session: "wmux",
				window: "@1",
			});
			expect(result).toContain("window=%401");
		});

		test("encodes % in pane ID", () => {
			const result = formatWorkspaceUrl({
				connection: "local",
				session: "wmux",
				window: "@1",
				pane: "%1",
			});
			expect(result).toContain("pane=%251");
		});
	});

	describe("invalid locations returning empty string", () => {
		test("returns empty string for null", () => {
			expect(formatWorkspaceUrl(null)).toBe("");
		});

		test("returns empty string for connection without session", () => {
			// Type assertion needed since TypeScript would prevent this
			expect(formatWorkspaceUrl({ connection: "local" } as WorkspaceLocation)).toBe("");
		});

		test("returns empty string for missing connection", () => {
			expect(formatWorkspaceUrl({ session: "wmux" } as WorkspaceLocation)).toBe("");
		});
	});
});

describe("round-trip: formatWorkspaceUrl -> parseWorkspaceUrl", () => {
	test("round-trips simple location", () => {
		const original: WorkspaceLocation = { connection: "local", session: "wmux" };
		const formatted = formatWorkspaceUrl(original);
		const parsed = parseWorkspaceUrl(formatted);
		expect(parsed).toEqual(original);
	});

	test("round-trips location with window and pane", () => {
		const original: WorkspaceLocation = {
			connection: "local",
			session: "wmux",
			window: "@1",
			pane: "%1",
		};
		const formatted = formatWorkspaceUrl(original);
		const parsed = parseWorkspaceUrl(formatted);
		expect(parsed).toEqual(original);
	});

	test("round-trips session with spaces", () => {
		const original: WorkspaceLocation = {
			connection: "local",
			session: "my session name",
		};
		const formatted = formatWorkspaceUrl(original);
		const parsed = parseWorkspaceUrl(formatted);
		expect(parsed).toEqual(original);
	});

	test("round-trips session with #", () => {
		const original: WorkspaceLocation = {
			connection: "local",
			session: "session#name",
		};
		const formatted = formatWorkspaceUrl(original);
		const parsed = parseWorkspaceUrl(formatted);
		expect(parsed).toEqual(original);
	});
});

describe("toSelectedPane", () => {
	test("maps connection to targetName", () => {
		const location: WorkspaceLocation = {
			connection: "my-connection",
			session: "wmux",
		};
		const result = toSelectedPane(location);
		expect(result.targetName).toBe("my-connection");
		expect(result.session).toBe("wmux");
	});

	test("preserves session", () => {
		const location: WorkspaceLocation = {
			connection: "local",
			session: "my-session",
		};
		const result = toSelectedPane(location);
		expect(result.session).toBe("my-session");
	});

	test("preserves optional window", () => {
		const location: WorkspaceLocation = {
			connection: "local",
			session: "wmux",
			window: "@1",
		};
		const result = toSelectedPane(location);
		expect(result.window).toBe("@1");
	});

	test("preserves optional pane", () => {
		const location: WorkspaceLocation = {
			connection: "local",
			session: "wmux",
			window: "@1",
			pane: "%1",
		};
		const result = toSelectedPane(location);
		expect(result.pane).toBe("%1");
	});

	test("handles full location", () => {
		const location: WorkspaceLocation = {
			connection: "conn1",
			session: "sess1",
			window: "@5",
			pane: "%10",
		};
		const result = toSelectedPane(location);
		expect(result).toEqual({
			targetName: "conn1",
			session: "sess1",
			window: "@5",
			pane: "%10",
		});
	});
});

describe("fromSelectedPane", () => {
	test("converts SelectedPane to WorkspaceLocation", () => {
		const pane: SelectedPane = {
			targetName: "my-connection",
			session: "wmux",
		};
		const result = fromSelectedPane(pane);
		expect(result).toEqual({
			connection: "my-connection",
			session: "wmux",
		});
	});

	test("maps targetName to connection", () => {
		const pane: SelectedPane = {
			targetName: "conn1",
			session: "sess1",
		};
		const result = fromSelectedPane(pane);
		expect(result?.connection).toBe("conn1");
	});

	test("preserves optional window", () => {
		const pane: SelectedPane = {
			targetName: "local",
			session: "wmux",
			window: "@1",
		};
		const result = fromSelectedPane(pane);
		expect(result?.window).toBe("@1");
	});

	test("preserves optional pane", () => {
		const pane: SelectedPane = {
			targetName: "local",
			session: "wmux",
			window: "@1",
			pane: "%1",
		};
		const result = fromSelectedPane(pane);
		expect(result?.pane).toBe("%1");
	});

	test("returns null for null input", () => {
		expect(fromSelectedPane(null)).toBeNull();
	});

	test("handles full SelectedPane", () => {
		const pane: SelectedPane = {
			targetName: "conn1",
			session: "sess1",
			window: "@5",
			pane: "%10",
		};
		const result = fromSelectedPane(pane);
		expect(result).toEqual({
			connection: "conn1",
			session: "sess1",
			window: "@5",
			pane: "%10",
		});
	});
});

describe("getWorkspaceHistoryAction", () => {
	describe("push actions", () => {
		test("null to non-null is push", () => {
			const next: SelectedPane = { targetName: "local", session: "wmux" };
			expect(getWorkspaceHistoryAction(null, next)).toBe("push");
		});

		test("session A to session B is push", () => {
			const prev: SelectedPane = { targetName: "local", session: "session1" };
			const next: SelectedPane = { targetName: "local", session: "session2" };
			expect(getWorkspaceHistoryAction(prev, next)).toBe("push");
		});

		test("different connections is push", () => {
			const prev: SelectedPane = { targetName: "conn1", session: "session1" };
			const next: SelectedPane = { targetName: "conn2", session: "session1" };
			expect(getWorkspaceHistoryAction(prev, next)).toBe("push");
		});

		test("same session, window A to window B is push", () => {
			const prev: SelectedPane = { targetName: "local", session: "wmux", window: "@1" };
			const next: SelectedPane = { targetName: "local", session: "wmux", window: "@2" };
			expect(getWorkspaceHistoryAction(prev, next)).toBe("push");
		});

		test("same session, no window to window is push", () => {
			const prev: SelectedPane = { targetName: "local", session: "wmux" };
			const next: SelectedPane = { targetName: "local", session: "wmux", window: "@1" };
			expect(getWorkspaceHistoryAction(prev, next)).toBe("push");
		});

		test("same session, window to no window is push", () => {
			const prev: SelectedPane = { targetName: "local", session: "wmux", window: "@1" };
			const next: SelectedPane = { targetName: "local", session: "wmux" };
			expect(getWorkspaceHistoryAction(prev, next)).toBe("push");
		});
	});

	describe("replace actions", () => {
		test("non-null to null is replace", () => {
			const prev: SelectedPane = { targetName: "local", session: "wmux" };
			expect(getWorkspaceHistoryAction(prev, null)).toBe("replace");
		});

		test("null to null is replace", () => {
			expect(getWorkspaceHistoryAction(null, null)).toBe("replace");
		});

		test("same session and window, pane A to pane B is replace", () => {
			const prev: SelectedPane = {
				targetName: "local",
				session: "wmux",
				window: "@1",
				pane: "%1",
			};
			const next: SelectedPane = {
				targetName: "local",
				session: "wmux",
				window: "@1",
				pane: "%2",
			};
			expect(getWorkspaceHistoryAction(prev, next)).toBe("replace");
		});

		test("same session and window, no pane to pane is replace", () => {
			const prev: SelectedPane = {
				targetName: "local",
				session: "wmux",
				window: "@1",
			};
			const next: SelectedPane = {
				targetName: "local",
				session: "wmux",
				window: "@1",
				pane: "%1",
			};
			expect(getWorkspaceHistoryAction(prev, next)).toBe("replace");
		});

		test("same session and window, pane to no pane is replace", () => {
			const prev: SelectedPane = {
				targetName: "local",
				session: "wmux",
				window: "@1",
				pane: "%1",
			};
			const next: SelectedPane = {
				targetName: "local",
				session: "wmux",
				window: "@1",
			};
			expect(getWorkspaceHistoryAction(prev, next)).toBe("replace");
		});

		test("identical location is replace (no-op case)", () => {
			const pane: SelectedPane = {
				targetName: "local",
				session: "wmux",
				window: "@1",
				pane: "%1",
			};
			expect(getWorkspaceHistoryAction(pane, pane)).toBe("replace");
		});
	});
});

describe("isStructurallyValidWorkspaceLocation", () => {
	describe("valid locations", () => {
		test("connection + session is valid", () => {
			expect(
				isStructurallyValidWorkspaceLocation({
					connection: "local",
					session: "wmux",
				}),
			).toBe(true);
		});

		test("connection + session + window is valid", () => {
			expect(
				isStructurallyValidWorkspaceLocation({
					connection: "local",
					session: "wmux",
					window: "@1",
				}),
			).toBe(true);
		});

		test("connection + session + window + pane is valid", () => {
			expect(
				isStructurallyValidWorkspaceLocation({
					connection: "local",
					session: "wmux",
					window: "@1",
					pane: "%1",
				}),
			).toBe(true);
		});
	});

	describe("invalid locations", () => {
		test("missing connection is invalid", () => {
			expect(
				isStructurallyValidWorkspaceLocation({
					session: "wmux",
				} as WorkspaceLocation),
			).toBe(false);
		});

		test("missing session is invalid", () => {
			expect(
				isStructurallyValidWorkspaceLocation({
					connection: "local",
				} as WorkspaceLocation),
			).toBe(false);
		});

		test("empty connection is invalid", () => {
			expect(
				isStructurallyValidWorkspaceLocation({
					connection: "",
					session: "wmux",
				}),
			).toBe(false);
		});

		test("empty session is invalid", () => {
			expect(
				isStructurallyValidWorkspaceLocation({
					connection: "local",
					session: "",
				}),
			).toBe(false);
		});

		test("pane without window is invalid", () => {
			expect(
				isStructurallyValidWorkspaceLocation({
					connection: "local",
					session: "wmux",
					pane: "%1",
				} as WorkspaceLocation),
			).toBe(false);
		});

		test("connection + session + pane (no window) is invalid", () => {
			expect(
				isStructurallyValidWorkspaceLocation({
					connection: "local",
					session: "wmux",
					pane: "%1",
				} as WorkspaceLocation),
			).toBe(false);
		});
	});
});

describe("acceptance criteria", () => {
	test("parseWorkspaceUrl with encoded @ and %", () => {
		const result = parseWorkspaceUrl("?connection=local&session=wmux&window=%401&pane=%251");
		expect(result).toEqual({
			connection: "local",
			session: "wmux",
			window: "@1",
			pane: "%1",
		});
	});

	test("pane without window returns null", () => {
		expect(parseWorkspaceUrl("?connection=local&session=wmux&pane=%251")).toBeNull();
	});

	test("formatWorkspaceUrl(null) returns empty string", () => {
		expect(formatWorkspaceUrl(null)).toBe("");
	});

	test("formatWorkspaceUrl with missing session returns empty string", () => {
		expect(formatWorkspaceUrl({ connection: "local" } as WorkspaceLocation)).toBe("");
	});
});
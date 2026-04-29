import { describe, test, expect } from "vitest";
import { ApiError, getErrorMessage } from "./errors.js";

describe("ApiError", () => {
	test("constructor sets all fields", () => {
		const err = new ApiError("unauthorized", "bad token", 401);
		expect(err.code).toBe("unauthorized");
		expect(err.message).toBe("bad token");
		expect(err.status).toBe(401);
		expect(err.name).toBe("ApiError");
	});

	test("is instance of Error", () => {
		const err = new ApiError("test", "message", 500);
		expect(err).toBeInstanceOf(Error);
	});
});

describe("getErrorMessage", () => {
	test("returns known message for known code", () => {
		expect(getErrorMessage("unauthorized")).toBe("Authentication required");
		expect(getErrorMessage("not_found")).toBe("Resource not found");
		expect(getErrorMessage("conflict")).toBe("Configuration was modified externally");
	});

	test("returns fallback for unknown code", () => {
		expect(getErrorMessage("unknown_code", "Custom fallback")).toBe("Custom fallback");
	});

	test("returns default for unknown code without fallback", () => {
		expect(getErrorMessage("unknown_code")).toBe("Error: unknown_code");
	});
});

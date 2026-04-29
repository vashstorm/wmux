// @ts-nocheck
import { expect, test } from "../../web/node_modules/@playwright/test/index.js";

test.describe("connection management", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("creates connection via API and shows in sidebar", async ({ page, request }) => {
		const response = await request.post("/api/connections", {
			headers: {
				Authorization: "Bearer playwright-token",
			},
			data: {
				type: "local",
			},
		});
		expect(response.ok()).toBeTruthy();

		await page.goto("/");

		await expect(page.getByTestId("sidebar")).toBeVisible();
		await expect(page.locator(".session-card").first()).toBeVisible();
	});

	test("connection health shows online for local", async ({ page, request }) => {
		const response = await request.post("/api/connections", {
			headers: {
				Authorization: "Bearer playwright-token",
			},
			data: {
				type: "local",
			},
		});
		expect(response.ok()).toBeTruthy();
		const connection = await response.json();

		await page.goto("/");

		await expect(page.getByTestId("sidebar")).toBeVisible();

		const healthResponse = await request.get(`/api/connections/${connection.id}/health`, {
			headers: {
				Authorization: "Bearer playwright-token",
			},
		});
		expect(healthResponse.ok()).toBeTruthy();
		const health = await healthResponse.json();
		expect(health.status).toBe("online");
	});
});

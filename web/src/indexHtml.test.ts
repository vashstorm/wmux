import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const testDir = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(testDir, "../index.html"), "utf8");

describe("index.html", () => {
	test("sets the app background before bundled CSS loads", () => {
		expect(indexHtml).toContain('<meta name="color-scheme" content="light dark" />');
		expect(indexHtml).toContain("background-color: #f8f9fc;");
		expect(indexHtml).toContain("@media (prefers-color-scheme: dark)");
		expect(indexHtml).toContain("background-color: #0d1117;");
		expect(indexHtml).toContain("#root {");
		expect(indexHtml).toContain("min-height: 100vh;");
	});
});

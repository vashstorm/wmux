import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	base: "/",
	plugins: [react()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
	test: {
		globals: true,
		environment: "jsdom",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		passWithNoTests: true,
		setupFiles: ["./src/test/setup.ts"],
	},
});

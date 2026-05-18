import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	base: "/",
	clearScreen: false,
	plugins: [react()],
	server: {
		strictPort: true,
		watch: {
			ignored: ["**/src-tauri/**"],
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rollupOptions: {
			output: {
				manualChunks: {
					vendor: ["react", "react-dom"],
					xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-web-links"],
				},
			},
		},
	},
	test: {
		globals: true,
		environment: "jsdom",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		passWithNoTests: true,
		setupFiles: ["./src/test/setup.ts"],
	},
});

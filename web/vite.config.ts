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
		chunkSizeWarningLimit: 1000,
		rollupOptions: {
			output: {
				manualChunks: {
					vendor: ["react", "react-dom"],
					mui: ["@mui/material", "@emotion/react", "@emotion/styled", "@mui/icons-material"],
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
		pool: "forks",
		poolOptions: {
			forks: {
				maxForks: 2,
				minForks: 1,
			},
		},
		fileParallelism: false,
	},
});

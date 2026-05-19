import { createTheme } from "@mui/material/styles";
import { useMemo } from "react";
import { THEME_OPTIONS } from "./themes.js";

export type ThemeMode = "light" | "dark";

export function createAppTheme(mode: ThemeMode) {
	return createTheme({ palette: { mode } });
}

export function useModeTheme(themeId: string) {
	return useMemo(() => {
		const theme = THEME_OPTIONS.find((t) => t.id === themeId);
		const mode: ThemeMode = theme?.mode ?? "dark";
		return createAppTheme(mode);
	}, [themeId]);
}

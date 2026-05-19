import { createTheme } from "@mui/material/styles";
import { useMemo } from "react";

export type ThemeMode = "light" | "dark";

export function createAppTheme(mode: ThemeMode) {
	return createTheme({ palette: { mode } });
}

export function useModeTheme(themeId: string) {
	return useMemo(() => {
		const mode: ThemeMode = themeId === "dark" ? "dark" : "light";
		return createAppTheme(mode);
	}, [themeId]);
}

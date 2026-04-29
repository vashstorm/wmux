export const MIN_UI_FONT_SIZE = 12;
export const MAX_UI_FONT_SIZE = 24;
export const DEFAULT_UI_FONT_SIZE = 16;

export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 32;
export const DEFAULT_TERMINAL_FONT_SIZE = 14;

export function clampUIFontSize(size: number): number {
	if (size < MIN_UI_FONT_SIZE) return MIN_UI_FONT_SIZE;
	if (size > MAX_UI_FONT_SIZE) return MAX_UI_FONT_SIZE;
	return size;
}

export function clampTerminalFontSize(size: number): number {
	if (size < MIN_TERMINAL_FONT_SIZE) return MIN_TERMINAL_FONT_SIZE;
	if (size > MAX_TERMINAL_FONT_SIZE) return MAX_TERMINAL_FONT_SIZE;
	return size;
}

export const VALID_TERMINAL_FONT_WEIGHTS = [
	"normal",
	"bold",
	"100",
	"200",
	"300",
	"400",
	"500",
	"600",
	"700",
	"800",
	"900",
] as const;

export type TerminalFontWeight = (typeof VALID_TERMINAL_FONT_WEIGHTS)[number];

export const DEFAULT_TERMINAL_FONT_WEIGHT: TerminalFontWeight = "normal";

export function normalizeTerminalFontWeight(value: string | undefined): TerminalFontWeight {
	if (!value) return DEFAULT_TERMINAL_FONT_WEIGHT;
	const normalized = value.trim().toLowerCase();
	if (VALID_TERMINAL_FONT_WEIGHTS.includes(normalized as TerminalFontWeight)) {
		return normalized as TerminalFontWeight;
	}
	return DEFAULT_TERMINAL_FONT_WEIGHT;
}

export function applyUIFontSize(baseSize: number): void {
	const root = document.documentElement;
	root.style.setProperty("--font-size-2xs", `${Math.round(baseSize * 0.625)}px`);
	root.style.setProperty("--font-size-xs", `${Math.round(baseSize * 0.6875)}px`);
	root.style.setProperty("--font-size-sm", `${Math.round(baseSize * 0.75)}px`);
	root.style.setProperty("--font-size-md", `${Math.round(baseSize * 0.8125)}px`);
	root.style.setProperty("--font-size-base", `${baseSize}px`);
	root.style.setProperty("--font-size-lg", `${Math.round(baseSize * 1.125)}px`);
	root.style.setProperty("--font-size-xl", `${Math.round(baseSize * 1.25)}px`);
	root.style.setProperty("--font-size-2xl", `${Math.round(baseSize * 1.5)}px`);
	root.style.setProperty("--font-size-3xl", `${Math.round(baseSize * 2.375)}px`);
}

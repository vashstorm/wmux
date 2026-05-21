export const MIN_UI_FONT_SIZE = 12;
export const MAX_UI_FONT_SIZE = 24;
export const DEFAULT_UI_FONT_SIZE = 16;

export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 32;
export const DEFAULT_TERMINAL_FONT_SIZE = 17;

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

// --- UI Scale Step System ---

export const MIN_UI_SCALE_STEP = -4;
export const MAX_UI_SCALE_STEP = 4;
export const DEFAULT_UI_SCALE_STEP = 0;

export function clampUIScaleStep(step: number): number {
	if (step < MIN_UI_SCALE_STEP) return MIN_UI_SCALE_STEP;
	if (step > MAX_UI_SCALE_STEP) return MAX_UI_SCALE_STEP;
	return step;
}

export function getUIScaleFactor(step: number): number {
	return 1 + clampUIScaleStep(step) * 0.05;
}

export function getUIFontBasePx(step: number): number {
	return Math.round(16 * getUIScaleFactor(step));
}

export function getTerminalFontPx(step: number): number {
	return Math.round(DEFAULT_TERMINAL_FONT_SIZE * getUIScaleFactor(step));
}

export function fontSizeToScaleStep(fontSize: number): number {
	return clampUIScaleStep(Math.round((fontSize / 16 - 1) / 0.05));
}

// Base spacing values at step 0 (from tokens.css)
const BASE_SPACING_PX: Record<string, number> = {
	"--spacing-xs": 4,
	"--spacing-sm": 8,
	"--spacing-md": 16,
	"--spacing-lg": 24,
	"--spacing-xl": 32,
	"--spacing-2xl": 48,
	"--spacing-3xl": 64,
	"--spacing-4xl": 80,
	"--spacing-5xl": 96,
};

export function applyUIScaleStep(step: number): void {
	const baseSize = getUIFontBasePx(step);
	const scaleFactor = getUIScaleFactor(step);
	const root = document.documentElement;

	// Font-size tokens
	root.style.setProperty("--font-size-2xs", `${Math.round(baseSize * 0.6875)}px`);
	root.style.setProperty("--font-size-xs", `${Math.round(baseSize * 0.75)}px`);
	root.style.setProperty("--font-size-sm", `${Math.round(baseSize * 0.8125)}px`);
	root.style.setProperty("--font-size-md", `${Math.round(baseSize * 0.875)}px`);
	root.style.setProperty("--font-size-base", `${baseSize}px`);
	root.style.setProperty("--font-size-lg", `${Math.round(baseSize * 1.125)}px`);
	root.style.setProperty("--font-size-xl", `${Math.round(baseSize * 1.25)}px`);
	root.style.setProperty("--font-size-2xl", `${Math.round(baseSize * 1.5)}px`);
	root.style.setProperty("--font-size-3xl", `${Math.round(baseSize * 2.375)}px`);

	// Spacing tokens (scaled proportionally)
	for (const [token, baseValue] of Object.entries(BASE_SPACING_PX)) {
		root.style.setProperty(token, `${Math.round(baseValue * scaleFactor)}px`);
	}
}

// --- Legacy compatibility ---

export function applyUIFontSize(baseSize: number): void {
	applyUIScaleStep(fontSizeToScaleStep(baseSize));
}

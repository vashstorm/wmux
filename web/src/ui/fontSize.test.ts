import {
	MIN_UI_SCALE_STEP,
	MAX_UI_SCALE_STEP,
	DEFAULT_UI_SCALE_STEP,
	clampUIScaleStep,
	getUIScaleFactor,
	getUIFontBasePx,
	getTerminalFontPx,
	fontSizeToScaleStep,
	applyUIScaleStep,
} from "../ui/fontSize.js";

describe("UI Scale Constants", () => {
	test("constants have expected values", () => {
		expect(MIN_UI_SCALE_STEP).toBe(-4);
		expect(MAX_UI_SCALE_STEP).toBe(4);
		expect(DEFAULT_UI_SCALE_STEP).toBe(0);
	});
});

describe("clampUIScaleStep", () => {
	test("clamps to bounds and passes through valid values", () => {
		expect(clampUIScaleStep(-99)).toBe(-4);
		expect(clampUIScaleStep(-4)).toBe(-4);
		expect(clampUIScaleStep(0)).toBe(0);
		expect(clampUIScaleStep(2)).toBe(2);
		expect(clampUIScaleStep(4)).toBe(4);
		expect(clampUIScaleStep(99)).toBe(4);
	});
});

describe("getUIScaleFactor", () => {
	test("returns correct factor for boundary and out-of-range steps", () => {
		expect(getUIScaleFactor(-4)).toBe(0.8);
		expect(getUIScaleFactor(0)).toBe(1);
		expect(getUIScaleFactor(4)).toBe(1.2);
		expect(getUIScaleFactor(-99)).toBe(0.8);
		expect(getUIScaleFactor(99)).toBe(1.2);
	});
});

describe("getUIFontBasePx", () => {
	test("computes base px and clamps out-of-range inputs", () => {
		expect(getUIFontBasePx(-4)).toBe(13);
		expect(getUIFontBasePx(0)).toBe(16);
		expect(getUIFontBasePx(4)).toBe(19);
		expect(getUIFontBasePx(-99)).toBe(13);
		expect(getUIFontBasePx(99)).toBe(19);
	});
});

describe("getTerminalFontPx", () => {
	test("computes terminal px and clamps out-of-range inputs", () => {
		expect(getTerminalFontPx(-4)).toBe(14);
		expect(getTerminalFontPx(0)).toBe(17);
		expect(getTerminalFontPx(4)).toBe(20);
		expect(getTerminalFontPx(-99)).toBe(14);
		expect(getTerminalFontPx(99)).toBe(20);
	});
});

describe("fontSizeToScaleStep", () => {
	test("maps font size to step and clamps out-of-range results", () => {
		expect(fontSizeToScaleStep(12)).toBe(-4);
		expect(fontSizeToScaleStep(16)).toBe(0);
		expect(fontSizeToScaleStep(18)).toBe(3);
		expect(fontSizeToScaleStep(20)).toBe(4);
		expect(fontSizeToScaleStep(24)).toBe(4);
	});
});

describe("applyUIScaleStep", () => {
	test("sets --font-size-base for boundary steps", () => {
		applyUIScaleStep(-4);
		expect(getComputedStyle(document.documentElement).getPropertyValue("--font-size-base").trim()).toBe("13px");

		applyUIScaleStep(0);
		expect(getComputedStyle(document.documentElement).getPropertyValue("--font-size-base").trim()).toBe("16px");

		applyUIScaleStep(2);
		expect(getComputedStyle(document.documentElement).getPropertyValue("--font-size-base").trim()).toBe("18px");

		applyUIScaleStep(4);
		expect(getComputedStyle(document.documentElement).getPropertyValue("--font-size-base").trim()).toBe("19px");
	});

	test("sets component font tokens at default scale", () => {
		applyUIScaleStep(0);
		const styles = getComputedStyle(document.documentElement);
		expect(styles.getPropertyValue("--font-size-2xs").trim()).toBe("11px");
		expect(styles.getPropertyValue("--font-size-xs").trim()).toBe("12px");
		expect(styles.getPropertyValue("--font-size-sm").trim()).toBe("13px");
		expect(styles.getPropertyValue("--font-size-md").trim()).toBe("14px");
	});
});

describe("applyUIScaleStep spacing tokens", () => {
	function getSpacingVar(name: string): string {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	}

	test("scales spacing tokens proportionally at boundary steps", () => {
		applyUIScaleStep(0);
		expect(getSpacingVar("--spacing-xs")).toBe("4px");
		expect(getSpacingVar("--spacing-sm")).toBe("8px");
		expect(getSpacingVar("--spacing-md")).toBe("16px");
		expect(getSpacingVar("--spacing-lg")).toBe("24px");
		expect(getSpacingVar("--spacing-xl")).toBe("32px");
		expect(getSpacingVar("--spacing-2xl")).toBe("48px");

		applyUIScaleStep(4);
		expect(getSpacingVar("--spacing-xs")).toBe("5px");
		expect(getSpacingVar("--spacing-sm")).toBe("10px");
		expect(getSpacingVar("--spacing-md")).toBe("19px");
		expect(getSpacingVar("--spacing-lg")).toBe("29px");
		expect(getSpacingVar("--spacing-xl")).toBe("38px");

		applyUIScaleStep(-4);
		expect(getSpacingVar("--spacing-xs")).toBe("3px");
		expect(getSpacingVar("--spacing-sm")).toBe("6px");
		expect(getSpacingVar("--spacing-md")).toBe("13px");
		expect(getSpacingVar("--spacing-lg")).toBe("19px");
		expect(getSpacingVar("--spacing-xl")).toBe("26px");
	});
});

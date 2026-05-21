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
	test("MIN_UI_SCALE_STEP is -4", () => {
		expect(MIN_UI_SCALE_STEP).toBe(-4);
	});

	test("MAX_UI_SCALE_STEP is 4", () => {
		expect(MAX_UI_SCALE_STEP).toBe(4);
	});

	test("DEFAULT_UI_SCALE_STEP is 0", () => {
		expect(DEFAULT_UI_SCALE_STEP).toBe(0);
	});
});

describe("clampUIScaleStep", () => {
	test("returns -4 when input is -99", () => {
		expect(clampUIScaleStep(-99)).toBe(-4);
	});

	test("returns 4 when input is 99", () => {
		expect(clampUIScaleStep(99)).toBe(4);
	});

	test("returns input when within range", () => {
		expect(clampUIScaleStep(0)).toBe(0);
		expect(clampUIScaleStep(2)).toBe(2);
	});
});

describe("getUIScaleFactor", () => {
	test("step -4 → 0.80", () => {
		expect(getUIScaleFactor(-4)).toBe(0.8);
	});

	test("step 0 → 1.00", () => {
		expect(getUIScaleFactor(0)).toBe(1);
	});

	test("step 4 → 1.20", () => {
		expect(getUIScaleFactor(4)).toBe(1.2);
	});

	test("out-of-range step is clamped", () => {
		expect(getUIScaleFactor(-99)).toBe(0.8);
		expect(getUIScaleFactor(99)).toBe(1.2);
	});
});

describe("getUIFontBasePx", () => {
	test("step -4 → 13px (16 * 0.80 rounded)", () => {
		expect(getUIFontBasePx(-4)).toBe(13);
	});

	test("step 0 → 16px (16 * 1.00)", () => {
		expect(getUIFontBasePx(0)).toBe(16);
	});

	test("step 4 → 19px (16 * 1.20 rounded)", () => {
		expect(getUIFontBasePx(4)).toBe(19);
	});

	test("out-of-range clamps before computing", () => {
		expect(getUIFontBasePx(-99)).toBe(13);
		expect(getUIFontBasePx(99)).toBe(19);
	});
});

describe("getTerminalFontPx", () => {
	test("step -4 → 11px (14 * 0.80 rounded)", () => {
		expect(getTerminalFontPx(-4)).toBe(11);
	});

	test("step 0 → 14px (14 * 1.00)", () => {
		expect(getTerminalFontPx(0)).toBe(14);
	});

	test("step 4 → 17px (14 * 1.20 rounded)", () => {
		expect(getTerminalFontPx(4)).toBe(17);
	});

	test("out-of-range clamps before computing", () => {
		expect(getTerminalFontPx(-99)).toBe(11);
		expect(getTerminalFontPx(99)).toBe(17);
	});
});

describe("fontSizeToScaleStep", () => {
	test("fontSize 12 → step -5, clamped to -4", () => {
		expect(fontSizeToScaleStep(12)).toBe(-4);
	});

	test("fontSize 16 → step 0", () => {
		expect(fontSizeToScaleStep(16)).toBe(0);
	});

	test("fontSize 18 → step 3", () => {
		expect(fontSizeToScaleStep(18)).toBe(3);
	});

	test("fontSize 20 → step 4", () => {
		expect(fontSizeToScaleStep(20)).toBe(4);
	});

	test("fontSize 24 → step 10, clamped to 4", () => {
		expect(fontSizeToScaleStep(24)).toBe(4);
	});
});

describe("applyUIScaleStep", () => {
	test("step 2 sets --font-size-base to 18px", () => {
		applyUIScaleStep(2);
		const value = getComputedStyle(document.documentElement).getPropertyValue("--font-size-base").trim();
		expect(value).toBe("18px");
	});

	test("step 0 sets --font-size-base to 16px", () => {
		applyUIScaleStep(0);
		const value = getComputedStyle(document.documentElement).getPropertyValue("--font-size-base").trim();
		expect(value).toBe("16px");
	});

	test("step 4 sets --font-size-base to 19px", () => {
		applyUIScaleStep(4);
		const value = getComputedStyle(document.documentElement).getPropertyValue("--font-size-base").trim();
		expect(value).toBe("19px");
	});

	test("step -4 sets --font-size-base to 13px", () => {
		applyUIScaleStep(-4);
		const value = getComputedStyle(document.documentElement).getPropertyValue("--font-size-base").trim();
		expect(value).toBe("13px");
	});
});

describe("applyUIScaleStep spacing tokens", () => {
	function getSpacingVar(name: string): string {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	}

	test("step 0 sets spacing tokens to default values", () => {
		applyUIScaleStep(0);
		expect(getSpacingVar("--spacing-xs")).toBe("4px");
		expect(getSpacingVar("--spacing-sm")).toBe("8px");
		expect(getSpacingVar("--spacing-md")).toBe("16px");
		expect(getSpacingVar("--spacing-lg")).toBe("24px");
		expect(getSpacingVar("--spacing-xl")).toBe("32px");
		expect(getSpacingVar("--spacing-2xl")).toBe("48px");
	});

	test("step 4 scales spacing tokens proportionally (factor 1.20)", () => {
		applyUIScaleStep(4);
		expect(getSpacingVar("--spacing-xs")).toBe("5px");   // round(4 * 1.20)
		expect(getSpacingVar("--spacing-sm")).toBe("10px");  // round(8 * 1.20)
		expect(getSpacingVar("--spacing-md")).toBe("19px");  // round(16 * 1.20)
		expect(getSpacingVar("--spacing-lg")).toBe("29px");  // round(24 * 1.20)
		expect(getSpacingVar("--spacing-xl")).toBe("38px");  // round(32 * 1.20)
	});

	test("step -4 scales spacing tokens proportionally (factor 0.80)", () => {
		applyUIScaleStep(-4);
		expect(getSpacingVar("--spacing-xs")).toBe("3px");   // round(4 * 0.80)
		expect(getSpacingVar("--spacing-sm")).toBe("6px");   // round(8 * 0.80)
		expect(getSpacingVar("--spacing-md")).toBe("13px");  // round(16 * 0.80)
		expect(getSpacingVar("--spacing-lg")).toBe("19px");  // round(24 * 0.80)
		expect(getSpacingVar("--spacing-xl")).toBe("26px");  // round(32 * 0.80)
	});
});

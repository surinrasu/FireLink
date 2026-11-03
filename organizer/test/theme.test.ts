import { describe, expect, test } from "bun:test";
import { DEFAULT_HUE, MAP_INK, normalizeHue, themeColors } from "../src/theme";

// Check the final sRGB colors, including gamut mapping and 8-bit rounding.
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = hex
      .slice(1)
      .match(/../g)!
      .map((c) => parseInt(c, 16) / 255);
    return rgb.reduce(
      (sum, v, i) =>
        sum +
        [0.2126, 0.7152, 0.0722][i] *
          (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4),
      0,
    );
  };
  const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}

describe("HCT theme accessibility contract", () => {
  test("H266 is the default and invalid persisted values cannot become CSS", () => {
    expect(DEFAULT_HUE).toBe(266);
    for (const value of [
      null,
      undefined,
      "",
      " ",
      "red",
      "0; color:red",
      NaN,
      Infinity,
      -1,
      360,
      true,
      {},
    ]) {
      expect(normalizeHue(value)).toBe(266);
    }
    expect(normalizeHue("0")).toBe(0);
    expect(normalizeHue("359")).toBe(359);
    expect(normalizeHue(359.8)).toBe(0);
  });

  for (const dark of [false, true]) {
    test(`all 360 hues preserve readable text and state indicators (${dark ? "dark" : "light"})`, () => {
      const semantic = themeColors(DEFAULT_HUE, dark);
      for (let hue = 0; hue < 360; hue++) {
        const c = themeColors(hue, dark);
        const check = (fg: string, bg: string, minimum: number) => {
          expect(
            contrast(c[fg], c[bg]),
            `H${hue} ${fg}/${bg}`,
          ).toBeGreaterThanOrEqual(minimum);
        };
        for (const role of ["primary", "secondary", "tertiary", "error"]) {
          check(`on-${role}`, role, 4.5);
          check(`on-${role}-container`, `${role}-container`, 4.5);
        }
        // Include the actual raised/hover surfaces, not just the nominal surface.
        for (const bg of [
          "background",
          "surface",
          "surface-container-low",
          "surface-container",
          "surface-container-high",
        ]) {
          for (const fg of [
            "on-surface",
            "on-surface-variant",
            "primary",
            "secondary",
            "error",
          ])
            check(fg, bg, 4.5);
          check("outline", bg, 3);
          check("on-primary-container", bg, 3); // selected navigation/review border
          check("on-secondary-container", bg, 3); // selected filter/view border
        }
        // Supporting text appears on these surfaces in the current components.
        check("on-surface-variant", "primary-container", 4.5);
        check("on-surface-variant", "secondary-container", 4.5);
        check("on-surface-variant", "success-bg", 4.5);
        check("on-surface", "primary-container", 4.5);
        check("secondary", "outline-variant", 3); // progress bar
        for (const role of ["success", "warning"])
          check(role, `${role}-bg`, 4.5);
        for (const role of [
          "success",
          "success-bg",
          "warning",
          "warning-bg",
          "error",
          "error-container",
          "on-error-container",
          "map-ink",
        ]) {
          expect(c[role]).toBe(semantic[role]);
        }
      }
    });
  }
  test("map numbers and white line casings contrast with fixed H266 ink", () => {
    expect(contrast(MAP_INK, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

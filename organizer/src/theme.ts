import {
  Hct,
  SchemeTonalSpot,
  argbFromHex,
  hexFromArgb,
} from "@material/material-color-utilities";

export const DEFAULT_HUE = 266;

/** The picker exposes integer hues only; invalid stored preferences use H266. */
export function normalizeHue(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string")
    return DEFAULT_HUE;
  if (typeof value === "string" && !value.trim()) return DEFAULT_HUE;
  const hue = Number(value);
  return Number.isFinite(hue) && hue >= 0 && hue < 360
    ? Math.round(hue) % 360
    : DEFAULT_HUE;
}

export const hctHex = (hue: number, chroma: number, tone: number) =>
  hexFromArgb(Hct.from(hue, chroma, tone).toInt());

// Map imagery stays light. Keep dark ink and a white casing in every theme.
export const MAP_INK = hctHex(DEFAULT_HUE, 48, 30);

export function themeColors(
  hue: number,
  dark: boolean,
): Record<string, string> {
  // Pin the spec as well as the dependency so upgrades cannot silently recolor UI.
  const scheme = new SchemeTonalSpot(
    Hct.from(normalizeHue(hue), 48, 50),
    dark,
    0,
    "2021",
  );
  const roles = [
    "primary",
    "onPrimary",
    "primaryContainer",
    "onPrimaryContainer",
    "secondary",
    "onSecondary",
    "secondaryContainer",
    "onSecondaryContainer",
    "tertiary",
    "onTertiary",
    "tertiaryContainer",
    "onTertiaryContainer",
    "error",
    "onError",
    "errorContainer",
    "onErrorContainer",
    "surface",
    "onSurface",
    "surfaceVariant",
    "onSurfaceVariant",
    "surfaceDim",
    "surfaceBright",
    "surfaceContainerLowest",
    "surfaceContainerLow",
    "surfaceContainer",
    "surfaceContainerHigh",
    "surfaceContainerHighest",
    "outline",
    "outlineVariant",
    "inverseSurface",
    "inverseOnSurface",
    "inversePrimary",
    "shadow",
    "scrim",
  ] as const;
  const colors: Record<string, string> = {};
  for (const role of roles) {
    const name = role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    colors[name] = hexFromArgb(scheme[role]);
  }
  colors.background = colors["surface-container-low"];
  colors["on-background"] = colors["on-surface"];
  // Status meanings do not rotate with the user's theme hue.
  for (const [name, semanticHue, chroma] of [
    ["success", 145, 32],
    ["warning", 85, 36],
  ] as const) {
    colors[name] = hctHex(semanticHue, chroma, dark ? 85 : 30);
    colors[`${name}-bg`] = hctHex(semanticHue, chroma, dark ? 20 : 94);
  }
  colors["map-ink"] = MAP_INK;
  colors["map-background"] = hctHex(DEFAULT_HUE, 4, 92);
  colors["media-backdrop"] = hctHex(DEFAULT_HUE, 4, 8);
  return colors;
}

/** Loaded before style.css so forced-colors and more-contrast always win. */
export function themeCss(hue = DEFAULT_HUE): string {
  const declarations = (dark: boolean) =>
    Object.entries(themeColors(hue, dark))
      .map(([name, value]) => `--${name}:${value};`)
      .join("");
  const light = declarations(false);
  const dark = declarations(true);
  return (
    `:root,body.light{color-scheme:light;${light}}\n` +
    `@media(prefers-color-scheme:dark){:root{color-scheme:dark;${dark}}}\n` +
    `body.dark{color-scheme:dark;${dark}}`
  );
}

// Representative names attested in 色谱 (1957); see README for name provenance.
// These RGB references are modern approximations from zhongguose.com/colors.json,
// not values defined by the book. Use their HCT hues to name nearby hue families
// only; theme generation must never depend on the naming references.
const hueNames = (
  [
    ["玫瑰红", "#d2357d"],
    ["海棠红", "#f03752"],
    ["银朱", "#f43e06"],
    ["杏黄", "#f28e16"],
    ["柠檬黄", "#fcd337"],
    ["鹦鹉绿", "#5bae23"],
    ["翠绿", "#20a162"],
    ["铜绿", "#2bae85"],
    ["清水蓝", "#93d5dc"],
    ["孔雀蓝", "#0eb0c9"],
    ["宝石蓝", "#2486b9"],
    ["靛青", "#1661ab"],
    ["藤萝紫", "#8076a3"],
    ["牵牛紫", "#681752"],
  ] as const
).map(([name, hex]) => ({ name, hue: Hct.fromInt(argbFromHex(hex)).hue }));

export function hueName(value: number): string {
  const hue = normalizeHue(value);
  const distance = (reference: number) => {
    const difference = Math.abs(hue - reference);
    return Math.min(difference, 360 - difference);
  };
  return hueNames.reduce((nearest, color) =>
    distance(color.hue) < distance(nearest.hue) ? color : nearest,
  ).name;
}

// Sample HCT itself; an HSL rainbow would put the handle over the wrong hue.
export const hueGradient = `conic-gradient(${Array.from(
  { length: 73 },
  (_, i) => `${hctHex(i * 5, 48, 65)} ${i * 5}deg`,
).join(",")})`;

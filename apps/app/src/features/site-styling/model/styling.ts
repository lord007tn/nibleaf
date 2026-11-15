/**
 * Site configuration → Styling, as pure logic: the legacy primary color
 * (`config.styling.primaryColor`) and corner radius (`config.styling.radius`).
 * Rendered by `components/styling-settings.tsx`.
 *
 * How the reader uses them (`resolveTheme` in packages/shared/src/themes.ts,
 * unchanged here):
 * - the primary color is the accent of both modes only where the theme has no
 *   accent of its own for that mode (`config.theme.colors.<mode>.accent`), and
 *   the reader nudges it until it reads as text on the canvas;
 * - a stored radius replaces the theme's `layout.radius`; with none stored, the
 *   theme's radius applies (its `layout.radius`, else its preset's). The form
 *   shows that inherited radius as such, and any radius the person chooses,
 *   even the one inherited, is stored for this website: a later theme change
 *   no longer moves it.
 * The appearance (`config.styling.theme`) belongs to the Theme section and is
 * never part of this form.
 */

import { resolveTheme, type ThemeOwnedProjectConfig } from '@nibleaf/shared/themes';

const RADII = ['sharp', 'rounded', 'pill'] as const;
export type Radius = (typeof RADII)[number];

/** `config.styling` as the API stores it. */
export type StylingConfig = { primaryColor?: string; theme?: 'light' | 'dark' | 'system'; radius?: Radius };

/** What a save sends: only the keys the person changed. Never the appearance. */
export type StylingPatch = { primaryColor?: string; radius?: Radius };

/**
 * The form's values.
 * - `primaryColor`: `''` when none is stored; `#rrggbb` (lowercase) when the
 *   text is a color; otherwise the text as typed, which is never sent.
 * - `radius`: `''` when none is stored (the theme's applies), else the
 *   website's own radius: stored, or chosen in this draft.
 */
export type StylingValues = { primaryColor: string; radius: Radius | '' };

/** What the controls show for an unset color (as the form always has). */
export const SHOWN_DEFAULT_COLOR = '#5546e8';

export const PRESETS = ['#5546e8', '#0ea5e9', '#16a34a', '#22c55e', '#eab308', '#ea580c', '#ef4444', '#db2777', '#a855f7', '#0f172a'] as const;

export type Hsl = { h: number; s: number; l: number };
export const HSL_MAX: Hsl = { h: 360, s: 100, l: 100 };

/**
 * A color typed with or without `#`, in 3 or 6 hex digits and any case, as the
 * server stores it: `#` and six lowercase digits. Anything else is `null`.
 */
export function parseHex(text: string): string | null {
  const digits = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(digits)) return `#${digits.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(digits)) {
    return `#${[...digits.toLowerCase()].map((digit) => digit + digit).join('')}`;
  }
  return null;
}

/** The text as the field keeps it while typing: a leading `#`, uppercase. */
export const hexText = (text: string): string => {
  const trimmed = text.trim();
  return (trimmed.startsWith('#') ? trimmed : `#${trimmed}`).toUpperCase();
};

/** The color the controls show for a value: the stored one, the default for none, `null` while the text is not a color. */
export const shownColor = (value: string): string | null => (value === '' ? SHOWN_DEFAULT_COLOR : parseHex(value));

/**
 * The radius the site gets from its theme when Styling stores none, as the
 * reader resolves it (`resolveTheme`): the theme's `layout.radius`, else its
 * preset's. Only `config.theme` decides it, so a stored or drafted
 * `styling.radius` never shows as inherited.
 */
export const inheritedRadius = (theme: ThemeOwnedProjectConfig['theme']): Radius => resolveTheme({ theme }).layout.radius;

/** The radius the control shows: the website's own, else the inherited one. */
export const shownRadius = (value: Radius | '', inherited: Radius): Radius => (value === '' ? inherited : value);

/** `config.styling` read as the form's values. A stored short color reads as its long form. */
export function stylingValues(styling: StylingConfig | null | undefined): StylingValues {
  const stored = styling?.primaryColor;
  const radius = styling?.radius;
  return {
    primaryColor: stored ? (parseHex(stored) ?? stored) : '',
    radius: radius && (RADII as readonly string[]).includes(radius) ? radius : '',
  };
}

/**
 * The value for a color the person typed (or picked), relative to `baseline`:
 * the same color as the baseline shows (by case, `#`, or short or long form)
 * keeps the baseline value, so it is not an edit and an unset color stays
 * unset. Text that is not a color is kept as typed.
 */
export function editColor(text: string, baseline: string): string {
  const typed = hexText(text);
  const color = parseHex(typed);
  if (!color) return typed;
  return color === shownColor(baseline) ? baseline : color;
}

/** The color problem a save would refuse: text that is not a color. */
export const colorProblem = (value: string): 'invalidHex' | null => (value === '' || parseHex(value) ? null : 'invalidHex');

/**
 * The `config.styling` patch: only the keys changed from `baseline` (what the
 * server confirmed when this save started). The server merges `styling` key by
 * key and keeps every key a patch leaves out, so an untouched color, radius or
 * appearance stays as stored, including another writer's. A radius chosen
 * over an unset one is sent even when it equals the inherited radius: the
 * choice is what stores it. `config.theme` and `styling.theme` are never sent. A value that can't be stored (`''`, or text
 * that is not a color) is never sent either; the form refuses the latter first.
 */
export function stylingPatch(values: StylingValues, baseline: StylingValues): StylingPatch {
  const patch: StylingPatch = {};
  const color = parseHex(values.primaryColor);
  if (values.primaryColor !== baseline.primaryColor && color) patch.primaryColor = color;
  if (values.radius !== baseline.radius && values.radius !== '') patch.radius = values.radius;
  return patch;
}

export const clamp = (value: number, min: number, max: number): number => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min);

/** A `#rrggbb` color as whole-number hue (0–359), saturation and lightness (0–100). */
export function hexToHsl(hex: string): Hsl | null {
  const color = parseHex(hex);
  if (!color) return null;
  const r = Number.parseInt(color.slice(1, 3), 16) / 255;
  const g = Number.parseInt(color.slice(3, 5), 16) / 255;
  const b = Number.parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Hue, saturation and lightness (clamped to the sliders' ranges; hue 360 is 0) as `#rrggbb`. */
export function hslToHex(hsl: Hsl): string {
  const h = clamp(hsl.h, 0, HSL_MAX.h);
  const sa = clamp(hsl.s, 0, HSL_MAX.s) / 100;
  const la = clamp(hsl.l, 0, HSL_MAX.l) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sa * Math.min(la, 1 - la);
  const f = (n: number) =>
    Math.round(255 * (la - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
      .toString(16)
      .padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}

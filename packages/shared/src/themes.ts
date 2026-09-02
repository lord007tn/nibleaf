export const THEME_SCHEMA_VERSION = 1 as const;
export const THEME_TEMPLATE_KIND = 'nibleaf-theme' as const;
export const MAX_THEME_TEMPLATE_BYTES = 128 * 1024;
export const MAX_THEME_TEMPLATE_DEPTH = 12;
export const MAX_THEME_TEMPLATE_NODES = 600;

const SAFE_THEME_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Sanitizers shared by every CSS renderer so live and exported themes enforce
 * the same interpolation boundary. */
export const safeThemeHex = (value: string | undefined, fallback: string): string => {
  if (!(value && SAFE_THEME_HEX.test(value))) return fallback;
  const normalized = value.toLowerCase();
  return normalized.length === 4 ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}` : normalized;
};

export const safeThemeFontFamily = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && /^[\p{L}\p{N} ._-]+$/u.test(trimmed) ? trimmed : undefined;
};

export type ThemePresetId = 'harbor' | 'manuscript' | 'signal';
export const THEME_PRESET_IDS = ['harbor', 'manuscript', 'signal'] as const satisfies readonly ThemePresetId[];

export type ThemeColorKey =
  | 'canvas'
  | 'foreground'
  | 'surface'
  | 'surfaceRaised'
  | 'muted'
  | 'mutedForeground'
  | 'border'
  | 'accent'
  | 'accentForeground'
  | 'focus'
  | 'code'
  | 'codeForeground'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';
export const THEME_COLOR_KEYS = [
  'canvas',
  'foreground',
  'surface',
  'surfaceRaised',
  'muted',
  'mutedForeground',
  'border',
  'accent',
  'accentForeground',
  'focus',
  'code',
  'codeForeground',
  'info',
  'success',
  'warning',
  'danger',
] as const satisfies readonly ThemeColorKey[];
export type ThemeColorTokens = Record<ThemeColorKey, string>;

/** Stable CSS interface for reader chrome, search, and future AI surfaces. */
export const THEME_TOKEN_CSS_VARIABLES = Object.fromEntries(THEME_COLOR_KEYS.map((key) => [key, `--theme-${key}`])) as unknown as Record<
  ThemeColorKey,
  `--theme-${string}`
>;

export interface ThemeMetadata {
  name: string;
  description: string;
  author?: string;
}

export interface ThemeLayout {
  /** Controls the placement of navigation, article, and page outline. This is
   * deliberately separate from visual styling so presets are true layouts. */
  shell: 'reference' | 'editorial' | 'console';
  density: 'compact' | 'comfortable' | 'relaxed';
  radius: 'sharp' | 'rounded' | 'pill';
  contentWidth: 'focused' | 'balanced' | 'wide';
  header: 'inline' | 'stacked' | 'floating';
  sidebar: 'bordered' | 'soft' | 'rail';
  navigation: 'tree' | 'sectioned' | 'compact';
}

export interface ThemeComponents {
  codeBlocks: 'system' | 'dim' | 'vivid';
  callouts: 'soft' | 'outline' | 'solid';
  cards: 'bordered' | 'lifted' | 'flat';
  tabs: 'underline' | 'pills' | 'boxed';
  tables: 'lines' | 'rows' | 'cards';
}

export interface NibleafThemeConfig {
  version?: typeof THEME_SCHEMA_VERSION;
  preset?: ThemePresetId;
  metadata?: ThemeMetadata;
  colors?: {
    light?: Partial<ThemeColorTokens>;
    dark?: Partial<ThemeColorTokens>;
  };
  layout?: Partial<ThemeLayout>;
  components?: Partial<ThemeComponents>;
}

export interface ThemeOwnedProjectConfig {
  theme?: NibleafThemeConfig;
  styling?: {
    primaryColor?: string;
    theme?: 'light' | 'dark' | 'system';
    radius?: ThemeLayout['radius'];
  };
  typography?: {
    headingFont?: string;
    bodyFont?: string;
    codeFont?: string;
    baseSize?: '14' | '15' | '16' | '17' | '18';
    leading?: '1.5' | '1.6' | '1.75' | '1.9' | '2';
    flow?: '0.75' | '1' | '1.25' | '1.5' | '2';
  };
  branding?: {
    logoLight?: string | null;
    logoDark?: string | null;
    favicon?: string | null;
    logoHref?: string | null;
  };
}

export interface ThemeTemplateV1 {
  kind: typeof THEME_TEMPLATE_KIND;
  version: typeof THEME_SCHEMA_VERSION;
  metadata: ThemeMetadata;
  config: ThemeOwnedProjectConfig;
}

export interface ResolvedTheme {
  id: ThemePresetId;
  metadata: ThemeMetadata;
  colors: { light: ThemeColorTokens; dark: ThemeColorTokens };
  layout: ThemeLayout;
  components: ThemeComponents;
}

export interface ThemePreset extends ResolvedTheme {
  rationale: string;
}

// Palette notes: every preset keeps a dark code surface in both modes so the
// code chrome (copy button, language label) never has to flip, surfaces layer
// canvas < surface < surfaceRaised, and dark modes are re-tuned rather than
// inverted (cooler shadows for Harbor, warm ink for Manuscript, near-black for
// Signal). themeContrastIssues() guards the AA pairs in themes.test.ts.
const HARBOR_LIGHT: ThemeColorTokens = {
  canvas: '#fbfcfd',
  foreground: '#141c2b',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  muted: '#eff3f7',
  mutedForeground: '#5b6577',
  border: '#e1e7ee',
  accent: '#1f63c4',
  accentForeground: '#ffffff',
  focus: '#1f63c4',
  code: '#0f172a',
  codeForeground: '#e2e8f0',
  info: '#1f63c4',
  success: '#12744a',
  warning: '#96560a',
  danger: '#b3243a',
};

const HARBOR_DARK: ThemeColorTokens = {
  canvas: '#0b1120',
  foreground: '#e8eef7',
  surface: '#111a2b',
  surfaceRaised: '#172236',
  muted: '#1a2436',
  mutedForeground: '#a3b1c4',
  border: '#25324a',
  accent: '#79b2f5',
  accentForeground: '#071224',
  focus: '#8fc1ff',
  code: '#070c16',
  codeForeground: '#e2e9f5',
  info: '#79b2f5',
  success: '#6ccb9a',
  warning: '#f2c06a',
  danger: '#ff8d9a',
};

const MANUSCRIPT_LIGHT: ThemeColorTokens = {
  canvas: '#f9f5ec',
  foreground: '#2a251f',
  surface: '#fffcf6',
  surfaceRaised: '#ffffff',
  muted: '#f0e9dc',
  mutedForeground: '#6a6157',
  border: '#e2d9c9',
  accent: '#9a4a2c',
  accentForeground: '#ffffff',
  focus: '#9a4a2c',
  code: '#2b2521',
  codeForeground: '#f3eadb',
  info: '#42667f',
  success: '#3c6d49',
  warning: '#8f5b0c',
  danger: '#a53a3a',
};

const MANUSCRIPT_DARK: ThemeColorTokens = {
  canvas: '#17140f',
  foreground: '#f3ecdf',
  surface: '#1f1b15',
  surfaceRaised: '#28221b',
  muted: '#2d261e',
  mutedForeground: '#c3b6a3',
  border: '#40362b',
  accent: '#e39b7d',
  accentForeground: '#24110a',
  focus: '#f2ae91',
  code: '#0f0d0b',
  codeForeground: '#f2e8d9',
  info: '#8fbadb',
  success: '#8bc898',
  warning: '#e8c073',
  danger: '#ef9494',
};

const SIGNAL_LIGHT: ThemeColorTokens = {
  canvas: '#f6f7fb',
  foreground: '#12141b',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  muted: '#e9ecf3',
  mutedForeground: '#535c6c',
  border: '#d8dde7',
  accent: '#5b35d5',
  accentForeground: '#ffffff',
  focus: '#5b35d5',
  code: '#0e0f1a',
  codeForeground: '#eeedff',
  info: '#2b5fc7',
  success: '#0b7a55',
  warning: '#8a5a00',
  danger: '#b41f44',
};

const SIGNAL_DARK: ThemeColorTokens = {
  canvas: '#0a0b11',
  foreground: '#f1f2f7',
  surface: '#12141d',
  surfaceRaised: '#191c27',
  muted: '#1e2230',
  mutedForeground: '#aab1bf',
  border: '#2a2f3e',
  accent: '#ab99ff',
  accentForeground: '#120a2f',
  focus: '#c0b1ff',
  code: '#050609',
  codeForeground: '#f0eeff',
  info: '#86adff',
  success: '#6bd8b0',
  warning: '#f2c467',
  danger: '#ff86a2',
};

export const THEME_PRESETS: Record<ThemePresetId, ThemePreset> = {
  harbor: {
    id: 'harbor',
    metadata: {
      name: 'Harbor',
      description: 'A balanced reference shell with persistent library navigation, reading column, and page outline.',
      author: 'Nibleaf',
    },
    rationale: 'For mixed guide/reference libraries that benefit from dependable three-column wayfinding.',
    colors: { light: HARBOR_LIGHT, dark: HARBOR_DARK },
    layout: {
      shell: 'reference',
      density: 'comfortable',
      radius: 'rounded',
      contentWidth: 'balanced',
      header: 'stacked',
      sidebar: 'bordered',
      navigation: 'sectioned',
    },
    components: { codeBlocks: 'system', callouts: 'soft', cards: 'bordered', tabs: 'underline', tables: 'lines' },
  },
  manuscript: {
    id: 'manuscript',
    metadata: {
      name: 'Manuscript',
      description: 'An editorial reading shell with a horizontal chapter deck and focused long-form measure.',
      author: 'Nibleaf',
    },
    rationale: 'For handbooks and knowledge bases where chapters frame a focused, long-form reading experience.',
    colors: { light: MANUSCRIPT_LIGHT, dark: MANUSCRIPT_DARK },
    layout: {
      shell: 'editorial',
      density: 'relaxed',
      radius: 'rounded',
      contentWidth: 'focused',
      header: 'inline',
      sidebar: 'soft',
      navigation: 'tree',
    },
    components: { codeBlocks: 'dim', callouts: 'outline', cards: 'flat', tabs: 'pills', tables: 'rows' },
  },
  signal: {
    id: 'signal',
    metadata: {
      name: 'Signal',
      description: 'A technical workspace with a compact library rail, wide canvas, and inline command index.',
      author: 'Nibleaf',
    },
    rationale: 'For API references where a dense rail, wide code surfaces, and fast section scanning matter most.',
    colors: { light: SIGNAL_LIGHT, dark: SIGNAL_DARK },
    layout: {
      shell: 'console',
      density: 'compact',
      radius: 'sharp',
      contentWidth: 'wide',
      header: 'floating',
      sidebar: 'rail',
      navigation: 'compact',
    },
    components: { codeBlocks: 'vivid', callouts: 'solid', cards: 'lifted', tabs: 'boxed', tables: 'cards' },
  },
};

const normalizeHex = (value: string): string => {
  const hex = value.toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/.test(hex)) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  return value;
};

const channel = (value: number): number => {
  const normalized = value / 255;
  return normalized <= 0.040_45 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (value: string): number => {
  const hex = normalizeHex(value);
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 0;
  return (
    0.2126 * channel(Number.parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(Number.parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channel(Number.parseInt(hex.slice(5, 7), 16))
  );
};

export const contrastRatio = (foreground: string, background: string): number => {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

export const contrastingText = (background: string): '#ffffff' | '#111318' =>
  contrastRatio('#ffffff', background) >= contrastRatio('#111318', background) ? '#ffffff' : '#111318';

const mixHex = (first: string, second: string, weight: number): string => {
  const a = normalizeHex(first);
  const b = normalizeHex(second);
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return first;
  const mixed = [1, 3, 5].map((start) =>
    Math.round(Number.parseInt(a.slice(start, start + 2), 16) * (1 - weight) + Number.parseInt(b.slice(start, start + 2), 16) * weight),
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
};

/** Nudge `color` towards white or black until it reads against `background`.
 * Used for accents on the canvas (3:1, large UI) and for accent text drawn on
 * the always-dark code surface (4.5:1). Returns the input untouched when it
 * already passes so preset palettes stay exactly as authored. */
export const readableOnBackground = (color: string, background: string, required = 4.5): string => {
  if (contrastRatio(color, background) >= required) return color;
  const target = relativeLuminance(background) < 0.35 ? '#ffffff' : '#000000';
  for (const weight of [0.18, 0.3, 0.42, 0.56, 0.7, 0.85]) {
    const mixed = mixHex(color, target, weight);
    if (contrastRatio(mixed, background) >= required) return mixed;
  }
  return target;
};

const readableAccent = (accent: string, canvas: string): string => readableOnBackground(accent, canvas, 3);

export const resolveTheme = (config?: ThemeOwnedProjectConfig | null): ResolvedTheme => {
  const id = config?.theme?.preset && THEME_PRESET_IDS.includes(config.theme.preset) ? config.theme.preset : 'harbor';
  const preset = THEME_PRESETS[id];
  const accent = config?.styling?.primaryColor ? normalizeHex(config.styling.primaryColor) : undefined;
  const resolveColors = (defaults: ThemeColorTokens, overrides?: Partial<ThemeColorTokens>): ThemeColorTokens =>
    Object.fromEntries(THEME_COLOR_KEYS.map((key) => [key, safeThemeHex(overrides?.[key], defaults[key])])) as ThemeColorTokens;
  const lightOverrides = config?.theme?.colors?.light;
  const darkOverrides = config?.theme?.colors?.dark;
  const light = resolveColors(preset.colors.light, lightOverrides);
  const dark = resolveColors(preset.colors.dark, darkOverrides);
  const hasLightAccent = Boolean(safeThemeHex(lightOverrides?.accent, ''));
  const hasDarkAccent = Boolean(safeThemeHex(darkOverrides?.accent, ''));
  if (hasLightAccent && !lightOverrides?.accentForeground) {
    light.accentForeground = contrastingText(light.accent);
  }
  if (hasLightAccent && !lightOverrides?.focus) light.focus = light.accent;
  if (hasDarkAccent && !darkOverrides?.accentForeground) {
    dark.accentForeground = contrastingText(dark.accent);
  }
  if (hasDarkAccent && !darkOverrides?.focus) dark.focus = dark.accent;
  if (accent && /^#[0-9a-f]{6}$/i.test(accent)) {
    if (!hasLightAccent) {
      light.accent = readableAccent(accent, light.canvas);
      light.accentForeground = contrastingText(light.accent);
      light.focus = light.accent;
    }
    if (!hasDarkAccent) {
      dark.accent = readableAccent(accent, dark.canvas);
      dark.accentForeground = contrastingText(dark.accent);
      dark.focus = dark.accent;
    }
  }
  return {
    id,
    metadata: { ...preset.metadata, ...config?.theme?.metadata },
    colors: { light, dark },
    layout: { ...preset.layout, ...config?.theme?.layout, ...(config?.styling?.radius ? { radius: config.styling.radius } : {}) },
    components: { ...preset.components, ...config?.theme?.components },
  };
};

export interface ThemeContrastIssue {
  mode: 'light' | 'dark';
  pair: string;
  ratio: number;
  required: number;
}

export const themeContrastIssues = (theme: ResolvedTheme): ThemeContrastIssue[] => {
  const issues: ThemeContrastIssue[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const colors = theme.colors[mode];
    for (const [pair, foreground, background, required] of [
      ['foreground/canvas', colors.foreground, colors.canvas, 4.5],
      ['mutedForeground/canvas', colors.mutedForeground, colors.canvas, 4.5],
      ['accentForeground/accent', colors.accentForeground, colors.accent, 4.5],
      ['accent/canvas', colors.accent, colors.canvas, 3],
      ['codeForeground/code', colors.codeForeground, colors.code, 4.5],
      ['focus/canvas', colors.focus, colors.canvas, 3],
      ['info/canvas', colors.info, colors.canvas, 4.5],
      ['success/canvas', colors.success, colors.canvas, 4.5],
      ['warning/canvas', colors.warning, colors.canvas, 4.5],
      ['danger/canvas', colors.danger, colors.canvas, 4.5],
    ] as const) {
      const ratio = contrastRatio(foreground, background);
      if (ratio < required) issues.push({ mode, pair, ratio, required });
    }
  }
  return issues;
};

const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor']);
const isPlainObject = (value: unknown): value is Record<string, unknown> => Object.prototype.toString.call(value) === '[object Object]';

export const inspectThemeTemplateInput = (input: unknown): { ok: true } | { ok: false; message: string } => {
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    return { ok: false, message: 'Theme template must be valid JSON without cyclic values.' };
  }
  if (new TextEncoder().encode(encoded).byteLength > MAX_THEME_TEMPLATE_BYTES) {
    return { ok: false, message: `Theme template exceeds the ${MAX_THEME_TEMPLATE_BYTES / 1024} KiB limit.` };
  }
  let nodes = 0;
  const visit = (value: unknown, depth: number): string | null => {
    nodes += 1;
    if (nodes > MAX_THEME_TEMPLATE_NODES) return `Theme template exceeds the ${MAX_THEME_TEMPLATE_NODES}-node complexity limit.`;
    if (depth > MAX_THEME_TEMPLATE_DEPTH) return `Theme template exceeds the maximum depth of ${MAX_THEME_TEMPLATE_DEPTH}.`;
    if (Array.isArray(value)) {
      for (const child of value) {
        const issue = visit(child, depth + 1);
        if (issue) return issue;
      }
      return null;
    }
    if (!isPlainObject(value)) return null;
    for (const [key, child] of Object.entries(value)) {
      if (dangerousKeys.has(key)) return `Theme template contains the unsafe key "${key}".`;
      const issue = visit(child, depth + 1);
      if (issue) return issue;
    }
    return null;
  };
  const issue = visit(input, 0);
  return issue ? { ok: false, message: issue } : { ok: true };
};

const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
};

export const canonicalThemeTemplateJson = (template: ThemeTemplateV1): string => `${JSON.stringify(sorted(template), null, 2)}\n`;

const themeOwnedKeys = new Set(['theme', 'styling', 'typography', 'branding']);

export const themeOwnedConfig = (config: Record<string, unknown> | null | undefined): ThemeOwnedProjectConfig => {
  const result: Record<string, unknown> = {};
  for (const key of themeOwnedKeys) {
    const value = config?.[key];
    if (value !== undefined) result[key] = value;
  }
  return result as ThemeOwnedProjectConfig;
};

const deepMerge = (current: unknown, incoming: unknown): unknown => {
  if (!isPlainObject(incoming)) return incoming;
  const base = isPlainObject(current) ? current : {};
  return Object.fromEntries(
    [...new Set([...Object.keys(base), ...Object.keys(incoming)])].map((key) => [
      key,
      key in incoming ? deepMerge(base[key], incoming[key]) : base[key],
    ]),
  );
};

export const applyThemeTemplateConfig = (
  existing: Record<string, unknown> | null | undefined,
  incoming: ThemeOwnedProjectConfig,
  mode: 'merge' | 'replace',
): Record<string, unknown> => {
  const preserved = Object.fromEntries(Object.entries(existing ?? {}).filter(([key]) => !themeOwnedKeys.has(key)));
  if (mode === 'replace') return { ...preserved, ...incoming };
  return { ...preserved, ...(deepMerge(themeOwnedConfig(existing), incoming) as ThemeOwnedProjectConfig) };
};

const flat = (value: unknown, prefix = ''): Record<string, unknown> => {
  if (!isPlainObject(value)) return { [prefix || '$']: value };
  const entries = Object.entries(value);
  if (entries.length === 0) return { [prefix || '$']: {} };
  return Object.assign({}, ...entries.map(([key, child]) => flat(child, prefix ? `${prefix}.${key}` : key)));
};

export interface ThemeConfigChange {
  path: string;
  before: unknown;
  after: unknown;
}

export const previewThemeConfigChanges = (before: Record<string, unknown>, after: Record<string, unknown>): ThemeConfigChange[] => {
  const beforeFlat = flat(themeOwnedConfig(before));
  const afterFlat = flat(themeOwnedConfig(after));
  return [...new Set([...Object.keys(beforeFlat), ...Object.keys(afterFlat)])]
    .sort()
    .filter((path) => JSON.stringify(beforeFlat[path]) !== JSON.stringify(afterFlat[path]))
    .map((path) => ({ path, before: beforeFlat[path], after: afterFlat[path] }));
};

export const themeTemplateFromConfig = (config: Record<string, unknown> | null | undefined): ThemeTemplateV1 => {
  const owned = themeOwnedConfig(config);
  const resolved = resolveTheme(owned);
  return {
    kind: THEME_TEMPLATE_KIND,
    version: THEME_SCHEMA_VERSION,
    metadata: resolved.metadata,
    config: {
      ...owned,
      theme: {
        version: THEME_SCHEMA_VERSION,
        preset: resolved.id,
        ...owned.theme,
        metadata: resolved.metadata,
      },
    },
  };
};

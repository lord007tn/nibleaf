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

export const THEME_PRESET_IDS = ['harbor', 'manuscript', 'signal'] as const;
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

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
] as const;
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
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

const HARBOR_LIGHT: ThemeColorTokens = {
  canvas: '#f8fafc',
  foreground: '#172033',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  muted: '#eef3f7',
  mutedForeground: '#536176',
  border: '#d7e0e9',
  accent: '#2368c4',
  accentForeground: '#ffffff',
  focus: '#2368c4',
  code: '#111827',
  codeForeground: '#e8eef8',
  info: '#2368c4',
  success: '#157347',
  warning: '#9a5b08',
  danger: '#b42336',
};

const HARBOR_DARK: ThemeColorTokens = {
  canvas: '#0c111b',
  foreground: '#edf3fb',
  surface: '#121a27',
  surfaceRaised: '#172131',
  muted: '#1c2738',
  mutedForeground: '#a9b7c9',
  border: '#2c3a4d',
  accent: '#74aef4',
  accentForeground: '#07111f',
  focus: '#8bc0ff',
  code: '#080d15',
  codeForeground: '#e7eef9',
  info: '#74aef4',
  success: '#62c995',
  warning: '#f0bd66',
  danger: '#ff8b98',
};

const MANUSCRIPT_LIGHT: ThemeColorTokens = {
  canvas: '#fbf8f1',
  foreground: '#29251f',
  surface: '#fffdf8',
  surfaceRaised: '#ffffff',
  muted: '#f2ede2',
  mutedForeground: '#665f55',
  border: '#ded5c6',
  accent: '#8a472f',
  accentForeground: '#ffffff',
  focus: '#8a472f',
  code: '#25211d',
  codeForeground: '#f8f0e5',
  info: '#486c8c',
  success: '#3f704d',
  warning: '#94600f',
  danger: '#a53b3b',
};

const MANUSCRIPT_DARK: ThemeColorTokens = {
  canvas: '#181511',
  foreground: '#f5eee3',
  surface: '#201c17',
  surfaceRaised: '#29231d',
  muted: '#302921',
  mutedForeground: '#c6b9a7',
  border: '#463b30',
  accent: '#e19a7e',
  accentForeground: '#22100a',
  focus: '#f1ad91',
  code: '#100e0c',
  codeForeground: '#f4eadc',
  info: '#8db9da',
  success: '#86c895',
  warning: '#e8bf72',
  danger: '#ef9292',
};

const SIGNAL_LIGHT: ThemeColorTokens = {
  canvas: '#f7f8fa',
  foreground: '#111318',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  muted: '#e9ecf1',
  mutedForeground: '#4f5968',
  border: '#cbd1db',
  accent: '#5b35d5',
  accentForeground: '#ffffff',
  focus: '#5b35d5',
  code: '#101019',
  codeForeground: '#f0efff',
  info: '#285cc4',
  success: '#087a55',
  warning: '#8e5c00',
  danger: '#b21f42',
};

const SIGNAL_DARK: ThemeColorTokens = {
  canvas: '#090a0f',
  foreground: '#f3f4f8',
  surface: '#11131a',
  surfaceRaised: '#181b24',
  muted: '#1e222d',
  mutedForeground: '#b0b6c3',
  border: '#303645',
  accent: '#a996ff',
  accentForeground: '#110a2d',
  focus: '#bdadff',
  code: '#050509',
  codeForeground: '#f2efff',
  info: '#83aaff',
  success: '#68d6ad',
  warning: '#f1c263',
  danger: '#ff83a0',
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
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
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

const readableAccent = (accent: string, canvas: string): string => {
  if (contrastRatio(accent, canvas) >= 3) return accent;
  const target = relativeLuminance(canvas) < 0.35 ? '#ffffff' : '#000000';
  for (const weight of [0.18, 0.3, 0.42, 0.56, 0.7]) {
    const mixed = mixHex(accent, target, weight);
    if (contrastRatio(mixed, canvas) >= 3) return mixed;
  }
  return target;
};

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
    if (!value || typeof value !== 'object') return null;
    for (const key of Object.keys(value)) {
      if (dangerousKeys.has(key)) return `Theme template contains the unsafe key "${key}".`;
      const issue = visit((value as Record<string, unknown>)[key], depth + 1);
      if (issue) return issue;
    }
    return null;
  };
  const issue = visit(input, 0);
  return issue ? { ok: false, message: issue } : { ok: true };
};

const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
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
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  return Object.fromEntries(
    [...new Set([...Object.keys(base), ...Object.keys(incoming)])].map((key) => [
      key,
      key in (incoming as Record<string, unknown>)
        ? deepMerge((base as Record<string, unknown>)[key], (incoming as Record<string, unknown>)[key])
        : (base as Record<string, unknown>)[key],
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { [prefix || '$']: value };
  const entries = Object.entries(value as Record<string, unknown>);
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

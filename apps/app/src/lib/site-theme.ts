import {
  type ResolvedTheme,
  resolveTheme,
  safeThemeFontFamily,
  safeThemeHex,
  THEME_TOKEN_CSS_VARIABLES,
  type ThemeColorTokens,
  type ThemeOwnedProjectConfig,
} from '@nibleaf/shared/themes';
import type { ProjectConfig } from '@nibleaf/validators';
import type { CSSProperties } from 'react';

const safeTokens = (tokens: ThemeColorTokens, fallback: ThemeColorTokens): ThemeColorTokens =>
  Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [key, safeThemeHex(value, fallback[key as keyof ThemeColorTokens])]),
  ) as ThemeColorTokens;

const designSystemAliases = (tokens: ThemeColorTokens): Record<string, string> => ({
  '--background': tokens.canvas,
  '--foreground': tokens.foreground,
  '--card': tokens.surface,
  '--card-foreground': tokens.foreground,
  '--popover': tokens.surfaceRaised,
  '--popover-foreground': tokens.foreground,
  '--primary': tokens.accent,
  '--primary-foreground': tokens.accentForeground,
  '--secondary': tokens.muted,
  '--secondary-foreground': tokens.foreground,
  '--muted': tokens.muted,
  '--muted-foreground': tokens.mutedForeground,
  '--accent': tokens.muted,
  '--accent-foreground': tokens.foreground,
  '--destructive': tokens.danger,
  '--border': tokens.border,
  '--input': tokens.border,
  '--ring': tokens.focus,
});

const tokenDeclarations = (tokens: ThemeColorTokens): string => {
  const semantic = Object.entries(tokens)
    .map(([key, value]) => `${THEME_TOKEN_CSS_VARIABLES[key as keyof ThemeColorTokens]}:${value}`)
    .join(';');
  return [semantic, ...Object.entries(designSystemAliases(tokens)).map(([name, value]) => `${name}:${value}`)].join(';');
};

// Projects created before theme schema v1 keep the design-system palette they
// already shipped. Semantic aliases make the new component contract available
// without silently recoloring an existing published site; selecting or importing
// a theme opts the project into the complete token projection below.
const legacyTokenDeclarations = (accent: string): string =>
  [
    '--theme-canvas:var(--background)',
    '--theme-foreground:var(--foreground)',
    '--theme-surface:var(--card)',
    '--theme-surface-raised:var(--popover)',
    '--theme-muted:var(--muted)',
    '--theme-muted-foreground:var(--muted-foreground)',
    '--theme-border:var(--border)',
    `--theme-accent:${accent}`,
    '--theme-accent-foreground:var(--primary-foreground)',
    `--theme-focus:${accent}`,
    '--theme-code:#0d1117',
    '--theme-code-foreground:#f8fafc',
    `--theme-info:${accent}`,
    '--theme-success:#15803d',
    '--theme-warning:#d97706',
    '--theme-danger:var(--destructive)',
  ].join(';');

const radiusValue = (radius: ResolvedTheme['layout']['radius']): string =>
  radius === 'sharp' ? '0.125rem' : radius === 'pill' ? '1rem' : '0.625rem';

export const resolveProjectTheme = (config?: ProjectConfig | null): ResolvedTheme => resolveTheme(config as ThemeOwnedProjectConfig | null);

const inlineScriptJson = (value: string): string =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');

/** Run after the dashboard bootstrap in `<head>` so a published site's stored
 * appearance wins before CSS paints. Inputs are JSON-encoded and the default is
 * already constrained by ProjectConfig's appearance enum. */
export const siteThemeNoFlashScript = (projectId: string, configured: 'light' | 'dark' | 'system' = 'light'): string =>
  `(function(){try{var k='nibleaf.site.theme.'+${inlineScriptJson(projectId)};var s=localStorage.getItem(k);var c=${inlineScriptJson(configured)};var d=s==='dark'||(s!=='light'&&(c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)));var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(_){}})();`;

export const projectThemeCss = (config?: ProjectConfig | null): string => {
  const theme = resolveProjectTheme(config);
  const preset = resolveTheme({ theme: { preset: theme.id } });
  const light = safeTokens(theme.colors.light, preset.colors.light);
  const dark = safeTokens(theme.colors.dark, preset.colors.dark);
  const headingFont = safeThemeFontFamily(config?.typography?.headingFont);
  const codeFont = safeThemeFontFamily(config?.typography?.codeFont);
  const legacyAccent = safeThemeHex(config?.styling?.primaryColor, '#5546e8');
  const legacyDarkAccent = `color-mix(in oklab,${legacyAccent} 72%,white)`;
  const colorRules = config?.theme
    ? [
        `:root,.nibleaf-site-chrome{${tokenDeclarations(light)};--radius:${radiusValue(theme.layout.radius)}}`,
        `:root.dark,:root.dark .nibleaf-site-chrome,.nibleaf-site-chrome.dark{${tokenDeclarations(dark)}}`,
      ]
    : [
        `:root,.nibleaf-site-chrome{${legacyTokenDeclarations(legacyAccent)};--primary:${legacyAccent};--ring:${legacyAccent};--radius:${radiusValue(theme.layout.radius)}}`,
        `:root.dark,:root.dark .nibleaf-site-chrome,.nibleaf-site-chrome.dark{--theme-accent:${legacyDarkAccent};--theme-focus:${legacyDarkAccent};--theme-info:${legacyDarkAccent};--primary:${legacyDarkAccent};--ring:${legacyDarkAccent}}`,
      ];
  return [
    ...colorRules,
    headingFont
      ? `.nibleaf-site-chrome :is(h1,h2,h3,h4,h5,h6){font-family:'${headingFont}','Noto Sans Arabic','Segoe UI',var(--font-sans,sans-serif)}`
      : '',
    codeFont ? `.nibleaf-site-chrome :is(code,pre,kbd){font-family:'${codeFont}',var(--font-mono,monospace)}` : '',
  ]
    .filter(Boolean)
    .join('');
};

export const projectThemeVariables = (config?: ProjectConfig | null, mode: 'light' | 'dark' = 'light'): CSSProperties => {
  const theme = resolveProjectTheme(config);
  const preset = resolveTheme({ theme: { preset: theme.id } });
  const tokens = safeTokens(theme.colors[mode], preset.colors[mode]);
  return {
    ...Object.fromEntries(Object.entries(tokens).map(([key, value]) => [THEME_TOKEN_CSS_VARIABLES[key as keyof ThemeColorTokens], value])),
    ...designSystemAliases(tokens),
    '--radius': radiusValue(theme.layout.radius),
    color: tokens.foreground,
    backgroundColor: tokens.canvas,
  } as CSSProperties;
};

export const projectThemeStyle = (config?: ProjectConfig | null): CSSProperties => {
  const theme = resolveProjectTheme(config);
  const typography = config?.typography;
  const densityScale = theme.layout.density === 'compact' ? '0.86' : theme.layout.density === 'relaxed' ? '1.14' : '1';
  const contentMax = theme.layout.contentWidth === 'focused' ? '72rem' : theme.layout.contentWidth === 'wide' ? '100rem' : '90rem';
  const style = {
    '--theme-density': densityScale,
    '--theme-content-max': contentMax,
    '--typeset-leading': typography?.leading ?? (theme.layout.density === 'compact' ? '1.6' : theme.layout.density === 'relaxed' ? '1.9' : '1.75'),
    '--typeset-flow': `${typography?.flow ?? (theme.layout.density === 'compact' ? '1' : theme.layout.density === 'relaxed' ? '1.5' : '1.25')}em`,
  } as Record<string, string>;
  if (typography?.baseSize) style.fontSize = `${typography.baseSize}px`;
  const bodyFont = safeThemeFontFamily(typography?.bodyFont);
  if (bodyFont) style.fontFamily = `'${bodyFont}','Noto Sans Arabic','Segoe UI',var(--font-sans,system-ui,sans-serif)`;
  return style as CSSProperties;
};

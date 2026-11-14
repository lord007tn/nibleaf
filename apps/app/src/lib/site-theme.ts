import {
  type ResolvedTheme,
  readableAccentText,
  readableCodeAccent,
  readableOnAccent,
  readableOnBackground,
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

// Derived (non-contract) variables: the accent as drawn on the always-dark
// code surface (Signal's rail, code-block chrome) is nudged towards white until
// it passes AA there and on the rail's active-item tint, since a light-mode
// accent rarely reads on near-black. It starts from the authored accent, not the
// canvas shade, which is darker in light mode (readableCodeAccent).
// The footer's small print ("Made with Nibleaf · Report abuse") uses the muted
// token nudged until it clears AA with room to spare on the page canvas: a
// palette accepted at 4.5:1 would otherwise put 12px text right at the limit.
const FOOTER_TEXT_CONTRAST = 4.7;
const footerMuted = (tokens: ThemeColorTokens): string => readableOnBackground(tokens.mutedForeground, tokens.canvas, FOOTER_TEXT_CONTRAST);

const derivedDeclarations = (tokens: ThemeColorTokens, authoredAccent: string): string =>
  `--theme-code-accent:${readableCodeAccent(authoredAccent, tokens.code)};--theme-code-muted:${readableOnBackground(tokens.mutedForeground, tokens.code)};--theme-footer-muted:${footerMuted(tokens)}`;

// The token contract names multi-word variables after their camelCase keys
// (`--theme-mutedForeground`), while reader styles read the kebab-case names
// legacy projects declare (`--theme-muted-foreground`). Without both spellings,
// rules such as Signal's code-surface rail resolve to nothing and fall back to
// dark text on a dark surface.
const kebabTokenAliases = (tokens: ThemeColorTokens): Record<string, string> =>
  Object.fromEntries(
    Object.entries(tokens)
      .filter(([key]) => /[A-Z]/.test(key))
      .map(([key, value]) => [`--theme-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value]),
  );

const tokenDeclarations = (tokens: ThemeColorTokens, authoredAccent: string): string => {
  const semantic = Object.entries(tokens)
    .map(([key, value]) => `${THEME_TOKEN_CSS_VARIABLES[key as keyof ThemeColorTokens]}:${value}`)
    .join(';');
  return [
    semantic,
    ...Object.entries(kebabTokenAliases(tokens)).map(([name, value]) => `${name}:${value}`),
    derivedDeclarations(tokens, authoredAccent),
    ...Object.entries(designSystemAliases(tokens)).map(([name, value]) => `${name}:${value}`),
  ].join(';');
};

// Projects created before theme schema v1 keep the design-system palette they
// already shipped. Semantic aliases make the new component contract available
// without silently recoloring an existing published site; selecting or importing
// a theme opts the project into the complete token projection below.
const legacyTokenDeclarations = (accent: string, brand: string): string =>
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
    // From the brand, as before: the light canvas shade is darker and reads worse on code.
    `--theme-code-accent:color-mix(in oklab,${brand} 55%,white)`,
    '--theme-code-muted:#a3aab8',
    // The legacy light palette's muted grey is 4.54:1 on its #fafafa canvas; this is 4.74:1.
    '--theme-footer-muted:#707070',
  ].join(';');

/** The design system's light canvas (packages/design-system globals.css), which pre-v1 sites draw on. */
const LEGACY_LIGHT_CANVAS = '#fafafa';
/** The design system's dark on-primary text, which dark pre-v1 sites have always used. */
const LEGACY_DARK_ON_ACCENT = '#171717';

const radiusValue = (radius: ResolvedTheme['layout']['radius']): string =>
  radius === 'sharp' ? '0.125rem' : radius === 'pill' ? '1rem' : '0.625rem';

export const resolveProjectTheme = (config?: ProjectConfig | null): ResolvedTheme => resolveTheme(config as ThemeOwnedProjectConfig | null);

/** The owner's accent per mode, before it is shaded to read on the canvas. */
const authoredAccents = (config: ProjectConfig | null | undefined, preset: ResolvedTheme) => {
  const authored = resolveTheme(config as ThemeOwnedProjectConfig | null, { authoredAccent: true });
  return {
    light: safeTokens(authored.colors.light, preset.colors.light).accent,
    dark: safeTokens(authored.colors.dark, preset.colors.dark).accent,
  };
};

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
  `(function(){try{var k='nibleaf.site.theme.'+${inlineScriptJson(projectId)};var s=localStorage.getItem(k);var c=${inlineScriptJson(configured)};var d=s==='dark'||(s!=='light'&&(c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)));var r=d?'dark':'light';var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(r);e.style.colorScheme=r;}catch(_){}})();`;

export const projectThemeCss = (config?: ProjectConfig | null): string => {
  const theme = resolveProjectTheme(config);
  const preset = resolveTheme({ theme: { preset: theme.id } });
  const light = safeTokens(theme.colors.light, preset.colors.light);
  const dark = safeTokens(theme.colors.dark, preset.colors.dark);
  const authored = authoredAccents(config, preset);
  const headingFont = safeThemeFontFamily(config?.typography?.headingFont);
  const codeFont = safeThemeFontFamily(config?.typography?.codeFont);
  // Pre-v1 sites draw on the design-system canvas (#fafafa in light). Their
  // accent is text too (links, the active nav item), so it gets the same AA
  // shade as a themed site's (PUB-006); the text on it is picked by contrast.
  const legacyBrand = safeThemeHex(config?.styling?.primaryColor, '#5546e8');
  const legacyAccent = readableAccentText(legacyBrand, LEGACY_LIGHT_CANVAS);
  const legacyAccentForeground = readableOnAccent(legacyAccent);
  // Dark mixes the brand itself towards white, as it always has (it passes there).
  const legacyDarkAccent = `color-mix(in oklab,${legacyBrand} 72%,white)`;
  const colorRules = config?.theme
    ? [
        `:root,.nibleaf-site-chrome{${tokenDeclarations(light, authored.light)};--radius:${radiusValue(theme.layout.radius)}}`,
        `:root.dark,:root.dark .nibleaf-site-chrome,.nibleaf-site-chrome.dark{${tokenDeclarations(dark, authored.dark)}}`,
      ]
    : [
        `:root,.nibleaf-site-chrome{${legacyTokenDeclarations(legacyAccent, legacyBrand)};--primary:${legacyAccent};--primary-foreground:${legacyAccentForeground};--theme-accent-foreground:${legacyAccentForeground};--ring:${legacyAccent};--radius:${radiusValue(theme.layout.radius)}}`,
        `:root.dark,:root.dark .nibleaf-site-chrome,.nibleaf-site-chrome.dark{--theme-accent:${legacyDarkAccent};--theme-focus:${legacyDarkAccent};--theme-info:${legacyDarkAccent};--primary:${legacyDarkAccent};--primary-foreground:${LEGACY_DARK_ON_ACCENT};--theme-accent-foreground:${LEGACY_DARK_ON_ACCENT};--ring:${legacyDarkAccent};--theme-footer-muted:var(--muted-foreground)}`,
      ];
  return [
    ...colorRules,
    headingFont
      ? `.nibleaf-site-chrome :is(h1,h2,h3,h4,h5,h6){font-family:'${headingFont}','Noto Sans Arabic Variable','Noto Sans Arabic','Segoe UI',var(--font-sans,sans-serif)}`
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
    ...kebabTokenAliases(tokens),
    '--theme-code-accent': readableCodeAccent(authoredAccents(config, preset)[mode], tokens.code),
    '--theme-code-muted': readableOnBackground(tokens.mutedForeground, tokens.code),
    '--theme-footer-muted': footerMuted(tokens),
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
  if (bodyFont) style.fontFamily = `'${bodyFont}','Noto Sans Arabic Variable','Noto Sans Arabic','Segoe UI',var(--font-sans,system-ui,sans-serif)`;
  return style as CSSProperties;
};

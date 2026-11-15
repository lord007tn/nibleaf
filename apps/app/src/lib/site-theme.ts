import {
  ACCENT_TEXT_CONTRAST,
  accentTextContrast,
  channelsContrast,
  channelsHex,
  contrastRatio,
  mixOklabChannels,
  type ResolvedTheme,
  type RgbChannels,
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

export { siteAppearance, siteThemeNoFlashScript } from '@/lib/site-theme-bootstrap';

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
const legacyTokenDeclarations = (accent: string, codeAccent: string): string =>
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
    `--theme-code-accent:${codeAccent}`,
    '--theme-code-muted:#a3aab8',
    // The legacy light palette's muted grey is 4.54:1 on its #fafafa canvas; this is 4.74:1.
    '--theme-footer-muted:#707070',
  ].join(';');

/** The mobile nav drawer is a popover on the raised surface (`bg-popover`), not
 * the canvas the accent is shaded for, so its active row (`text-primary` on
 * `bg-primary/10`) can fall short there: #b96a3d on Harbor dark read 3.81:1 (#726).
 * The drawer gets the nearest shade that reads on that surface and its tint,
 * with on-accent text that still reads on the shade; null when the canvas
 * shade already reads there, so most sites' CSS is unchanged. */
type DrawerTokens = Pick<ThemeColorTokens, 'accent' | 'accentForeground' | 'surfaceRaised'>;
type DrawerShade = { primary: string; foreground: string } | null;
/** The drawer's shade `primary`, with the palette's on-accent text when it still reads on it. */
const drawerShade = (primary: string, accentForeground: string): DrawerShade => ({
  primary,
  foreground: contrastRatio(accentForeground, primary) >= ACCENT_TEXT_CONTRAST ? accentForeground : readableOnAccent(primary),
});
const drawerAccent = (tokens: DrawerTokens): DrawerShade => {
  const primary = readableAccentText(tokens.accent, tokens.surfaceRaised);
  return primary === tokens.accent ? null : drawerShade(primary, tokens.accentForeground);
};

/** The drawer's accent rules, light then dark. Both are written when either mode
 * needs a shade, since the light rule would otherwise apply in dark too. */
const drawerAccentRules = (
  light: DrawerTokens,
  dark: DrawerTokens,
  lightShade: DrawerShade = drawerAccent(light),
  darkShade: DrawerShade = drawerAccent(dark),
): string[] => {
  if (!lightShade && !darkShade) return [];
  const declarations = (tokens: DrawerTokens, shade: DrawerShade) =>
    `--primary:${shade?.primary ?? tokens.accent};--primary-foreground:${shade?.foreground ?? tokens.accentForeground}`;
  return [
    `[data-site-drawer]{${declarations(light, lightShade)}}`,
    `:root.dark [data-site-drawer],.nibleaf-site-chrome.dark [data-site-drawer]{${declarations(dark, darkShade)}}`,
  ];
};

/** The design system's light canvas (packages/design-system globals.css), which pre-v1 sites draw on. */
const LEGACY_LIGHT_CANVAS = '#fafafa';
const LEGACY_LIGHT_SURFACE = '#ffffff';
/** The design system's dark on-primary text, which dark pre-v1 sites have always used. */
const LEGACY_DARK_ON_ACCENT = '#171717';
/** The design system's dark canvas and its raised surface (card, popover, the drawer). */
const LEGACY_DARK_CANVAS = '#0a0a0a';
const LEGACY_DARK_SURFACE = '#171717';
/** The legacy code surface (`--theme-code`). */
const LEGACY_CODE = '#0d1117';

/** A shipped `color-mix()` is kept only when its unrounded colour clears AA by
 * this much: the browser keeps the fraction, and rendering mustn't land under the
 * line (#2d25e3 mixes to #5874f1, 4.5003:1 on its tint, but 4.4760:1 unrounded). */
const MIX_MARGIN = 0.01;
const mixReads = (ratio: number): boolean => ratio >= ACCENT_TEXT_CONTRAST + MIX_MARGIN;

/** Pre-v1 dark mode mixes the brand towards white, as it always has. That reads
 * for most brands, so their CSS keeps the `color-mix()` exactly as it shipped;
 * a dark brand (OKLab lightness below about 0.41: black, navy, forest green)
 * mixes to a colour that doesn't read on the #0a0a0a canvas (#000000 gave
 * #292929, 1.36:1). Each mix is judged by its unrounded colour as the browser
 * renders it (mixOklabChannels); one that falls short is replaced by the nearest
 * shade that reads, emitted as a hex, whose contrast is then exact (#744). */
const legacyDarkPalette = (brand: string) => {
  const mixed = mixOklabChannels(brand, '#ffffff', 0.72) as RgbChannels;
  const onCanvas = accentTextContrast(mixed, LEGACY_DARK_CANVAS);
  const keepsMix = mixReads(onCanvas.canvas) && mixReads(onCanvas.tint) && mixReads(channelsContrast(LEGACY_DARK_ON_ACCENT, mixed));
  let accent: string;
  let foreground: string;
  let drawer: DrawerShade;
  if (keepsMix) {
    accent = `color-mix(in oklab,${brand} 72%,white)`;
    foreground = LEGACY_DARK_ON_ACCENT;
    const onSurface = accentTextContrast(mixed, LEGACY_DARK_SURFACE);
    drawer =
      mixReads(onSurface.canvas) && mixReads(onSurface.tint)
        ? null
        : drawerShade(readableAccentText(channelsHex(mixed), LEGACY_DARK_SURFACE), LEGACY_DARK_ON_ACCENT);
  } else {
    accent = readableAccentText(channelsHex(mixed), LEGACY_DARK_CANVAS);
    foreground = contrastRatio(LEGACY_DARK_ON_ACCENT, accent) >= ACCENT_TEXT_CONTRAST ? LEGACY_DARK_ON_ACCENT : readableOnAccent(accent);
    drawer = drawerAccent({ accent, accentForeground: foreground, surfaceRaised: LEGACY_DARK_SURFACE });
  }
  const codeMix = mixOklabChannels(brand, '#ffffff', 0.55) as RgbChannels;
  const codeAccent = mixReads(channelsContrast(codeMix, LEGACY_CODE))
    ? `color-mix(in oklab,${brand} 55%,white)`
    : readableOnBackground(channelsHex(codeMix), LEGACY_CODE);
  return { accent, foreground, codeAccent, drawer };
};

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
  const legacyDark = legacyDarkPalette(legacyBrand);
  const legacyDarkAccent = legacyDark.accent;
  const legacyLightDrawer = { accent: legacyAccent, accentForeground: legacyAccentForeground, surfaceRaised: LEGACY_LIGHT_SURFACE };
  const legacyDrawerRules = drawerAccentRules(
    legacyLightDrawer,
    { accent: legacyDarkAccent, accentForeground: legacyDark.foreground, surfaceRaised: LEGACY_DARK_SURFACE },
    drawerAccent(legacyLightDrawer),
    legacyDark.drawer,
  );
  const colorRules = config?.theme
    ? [
        `:root,.nibleaf-site-chrome{${tokenDeclarations(light, authored.light)};--radius:${radiusValue(theme.layout.radius)}}`,
        `:root.dark,:root.dark .nibleaf-site-chrome,.nibleaf-site-chrome.dark{${tokenDeclarations(dark, authored.dark)}}`,
        // A solid callout is a console panel on the code surface in both modes, so
        // everything inside it uses the dark palette: its text, muted text and any
        // card, table, step or tab nested in it read as they do in dark mode,
        // where every surface is checked (PUB-019). Its links keep the code accent,
        // as before. Without this, light mode drew page text on the dark fill.
        // The outer .typeset derives --typeset-muted and --typeset-rule from the
        // light palette and descendants inherit those values, so they are bound
        // again here (h5/h6 and rules use them).
        `.nibleaf-site-chrome[data-theme-callouts="solid"] [data-theme-component="callout"]{${tokenDeclarations(dark, authored.dark)};--primary:var(--theme-code-accent);--typeset-muted:var(--muted-foreground);--typeset-rule:var(--border)}`,
        ...drawerAccentRules(light, dark),
      ]
    : [
        `:root,.nibleaf-site-chrome{${legacyTokenDeclarations(legacyAccent, legacyDark.codeAccent)};--primary:${legacyAccent};--primary-foreground:${legacyAccentForeground};--theme-accent-foreground:${legacyAccentForeground};--ring:${legacyAccent};--radius:${radiusValue(theme.layout.radius)}}`,
        `:root.dark,:root.dark .nibleaf-site-chrome,.nibleaf-site-chrome.dark{--theme-accent:${legacyDarkAccent};--theme-focus:${legacyDarkAccent};--theme-info:${legacyDarkAccent};--primary:${legacyDarkAccent};--primary-foreground:${legacyDark.foreground};--theme-accent-foreground:${legacyDark.foreground};--ring:${legacyDarkAccent};--theme-footer-muted:var(--muted-foreground)}`,
        // The drawer draws on the lighter #171717 popover, where a shade that reads on the canvas can fall short.
        ...legacyDrawerRules,
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

import {
  ACCENT_TEXT_CONTRAST,
  accentTextContrast,
  channelsContrast,
  channelsHex,
  contrastRatio,
  mixOklab,
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

/** The active row's `bg-primary/10`. */
const ACTIVE_ROW_TINT = 0.1;
const hexRgb = (hex: string): RgbChannels => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as unknown as RgbChannels;

/** A hex replacement is drawn exactly, but the tint under it is composited and
 * stored at 8 bits a channel, which can land under the line: #2d25e3's #5874f1
 * read 4.5003:1 on its ideal tint and 4.4879:1 on the rounded one (#758). So a
 * replacement takes the mix's margin on the background, on its tint as composited
 * and on that tint rounded. */
const replacementReads = (hex: string, background: string): boolean => {
  const color = hexRgb(hex);
  const { canvas, tint } = accentTextContrast(color, background);
  const rounded = hexRgb(background).map((value, index) =>
    Math.round(value * (1 - ACTIVE_ROW_TINT) + (color[index] ?? 0) * ACTIVE_ROW_TINT),
  ) as unknown as RgbChannels;
  return mixReads(canvas) && mixReads(tint) && mixReads(channelsContrast(color, rounded));
};

/** The first of `color`'s 40 steps towards white that `reads` (white always does on these dark backgrounds). */
const lighterUntil = (color: string, reads: (hex: string) => boolean): string => {
  const channels = hexRgb(color);
  for (let step = 1; step <= 40; step++) {
    const shade = channelsHex(channels.map((value) => value * (1 - step / 40) + 255 * (step / 40)) as unknown as RgbChannels);
    if (reads(shade)) return shade;
  }
  return '#ffffff';
};

/** The nearest shade of `color` that reads as accent text on `background` with
 * the margin: the shade #744 picked whenever it already has it, so those sites
 * keep their CSS. */
const legacyAccentText = (color: string, background: string): string => {
  const shaded = readableAccentText(color, background);
  return replacementReads(shaded, background) ? shaded : lighterUntil(color, (shade) => replacementReads(shade, background));
};

/** Text on a replacement `accent`: `preferred` while it reads with the margin, then
 * the text #744 would pick, then black or white (one of which reaches about 4.58:1). */
const legacyOnAccent = (accent: string, preferred: string): string =>
  [preferred, readableOnAccent(accent), '#000000', '#ffffff'].find((text) => mixReads(contrastRatio(text, accent))) ?? readableOnAccent(accent);

/** The drawer's shade of a replacement `accent` on the #171717 popover; null when `accent` already reads there. */
const legacyDrawer = (accent: string, foreground: string): DrawerShade => {
  const primary = legacyAccentText(accent, LEGACY_DARK_SURFACE);
  return primary === accent ? null : { primary, foreground: legacyOnAccent(primary, foreground) };
};

/** The code accent on the #0d1117 code surface, with the margin. */
const legacyCodeAccent = (color: string): string => {
  const shaded = readableOnBackground(color, LEGACY_CODE);
  const reads = (shade: string) => mixReads(contrastRatio(shade, LEGACY_CODE));
  return reads(shaded) ? shaded : lighterUntil(color, reads);
};

/** Pre-v1 dark mode mixes the brand towards white, as it always has. That reads
 * for most brands, so their CSS keeps the `color-mix()` exactly as it shipped;
 * a dark brand (OKLab lightness below about 0.41: black, navy, forest green)
 * mixes to a colour that doesn't read on the #0a0a0a canvas (#000000 gave
 * #292929, 1.36:1). Each mix is judged by its unrounded colour as the browser
 * renders it (mixOklabChannels); one that falls short is replaced by the nearest
 * shade that reads with the same margin, emitted as a hex (#744, #758). */
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
    if (mixReads(onSurface.canvas) && mixReads(onSurface.tint)) drawer = null;
    else {
      const primary = legacyAccentText(channelsHex(mixed), LEGACY_DARK_SURFACE);
      drawer = { primary, foreground: legacyOnAccent(primary, LEGACY_DARK_ON_ACCENT) };
    }
  } else {
    accent = legacyAccentText(channelsHex(mixed), LEGACY_DARK_CANVAS);
    foreground = legacyOnAccent(accent, LEGACY_DARK_ON_ACCENT);
    drawer = legacyDrawer(accent, foreground);
  }
  const codeMix = mixOklabChannels(brand, '#ffffff', 0.55) as RgbChannels;
  const codeAccent = mixReads(channelsContrast(codeMix, LEGACY_CODE))
    ? `color-mix(in oklab,${brand} 55%,white)`
    : legacyCodeAccent(channelsHex(codeMix));
  return { accent, foreground, codeAccent, drawer };
};

/** The solid callout's fill per callout type: `color-mix(in oklab,<tone> 14%,var(--theme-code))` (styles.css). */
const SOLID_CALLOUT_TONES = ['info', 'success', 'warning', 'danger'] as const;
const SOLID_CALLOUT_TINT = 0.14;

type Fill = RgbChannels | string;
const readsOnEvery = (fills: Fill[]) => (color: string) => fills.every((fill) => mixReads(channelsContrast(color, fill)));
const weakestContrast = (color: string, fills: Fill[]) => Math.min(...fills.map((fill) => channelsContrast(color, fill)));

/** The first of `color`'s 40 OKLab steps towards `toward` that `reads`; null when none does. */
const shadeUntil = (color: string, toward: string, reads: (shade: string) => boolean): string | null => {
  for (let step = 1; step <= 40; step++) {
    const shade = mixOklab(color, toward, 1 - step / 40);
    if (reads(shade)) return shade;
  }
  return null;
};

/** `color` while it reads on every one of `fills`, else its nearest shade that
 * does, towards whichever of white and black reads better there. On a single
 * fill that always ends in a pass (black or white reaches about 4.58:1 on any
 * colour). Fills that are far apart may have no such shade; then the grey that
 * reads best on the weakest of them. */
const readableOnFills = (color: string, fills: Fill[]): string => {
  const reads = readsOnEvery(fills);
  if (reads(color)) return color;
  const toward = weakestContrast('#ffffff', fills) >= weakestContrast('#000000', fills) ? '#ffffff' : '#000000';
  const shade = shadeUntil(color, toward, reads);
  if (shade) return shade;
  let best = { grey: color, contrast: weakestContrast(color, fills) };
  for (let level = 0; level <= 255; level++) {
    const grey = channelsHex([level, level, level]);
    const contrast = weakestContrast(grey, fills);
    if (contrast > best.contrast) best = { grey, contrast };
  }
  return best.grey;
};

/** A solid callout's `--primary` (its links, and the active label of a tab list
 * nested in it), and, rarely, a separate one for a boxed or pill tab list in it.
 * The code accent is shaded for the code surface, but this text sits on lighter
 * fills: the callout's tinted fill, and the muted fill of a boxed or pill tab
 * list. For most accents it reads there too and the rule keeps
 * `var(--theme-code-accent)`; otherwise it gets the nearest lighter (or darker,
 * on a light code surface) shade that reads on every fill, judged unrounded as
 * the browser draws the mix. #b96a3d on Signal gave #bb6e42: 4.09:1 on the tab
 * list's #1e2230 (#682).
 *
 * The search ends at white (black on a light code surface), so it only runs out
 * when that endpoint fails on one of the fills: surface overrides that put the
 * muted fill on the far side of the code surface, such as a light `muted` with a
 * near-black `code` in the dark palette (#832). No preset and no accent gets
 * there; only conflicting overrides do. No single colour can then reach 4.5:1 on
 * both sides (a white tab list in a black callout leaves #777777 at 4.48:1 on
 * the best of them), so the two get their own colours, each the nearest shade of
 * the code accent that reads on its fills: `--primary` on the four callout fills,
 * which links and an underline tab list's labels sit on, and a `tabList` value
 * the CSS sets on boxed and pill tab lists, which draw the muted fill. Like the
 * rest of the theme, the result depends on the tokens alone. */
const solidCalloutPrimary = (tokens: ThemeColorTokens, authoredAccent: string): { primary: string; tabList?: string } => {
  const codeAccent = readableCodeAccent(authoredAccent, tokens.code);
  const calloutFills: Fill[] = [];
  for (const tone of SOLID_CALLOUT_TONES) {
    const fill = mixOklabChannels(tokens[tone], tokens.code, SOLID_CALLOUT_TINT);
    if (fill) calloutFills.push(fill);
  }
  const reads = readsOnEvery([tokens.muted, ...calloutFills]);
  if (reads(codeAccent)) return { primary: 'var(--theme-code-accent)' };
  const toward = contrastRatio('#ffffff', tokens.code) >= contrastRatio('#000000', tokens.code) ? '#ffffff' : '#000000';
  const shade = shadeUntil(codeAccent, toward, reads);
  if (shade) return { primary: shade };
  const onCallout = readableOnFills(codeAccent, calloutFills);
  return {
    primary: onCallout === codeAccent ? 'var(--theme-code-accent)' : onCallout,
    tabList: readableOnFills(codeAccent, [tokens.muted]),
  };
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
  const solidCallout = solidCalloutPrimary(dark, authored.dark);
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
        `.nibleaf-site-chrome[data-theme-callouts="solid"] [data-theme-component="callout"]{${tokenDeclarations(dark, authored.dark)};--primary:${solidCallout.primary};--typeset-muted:var(--muted-foreground);--typeset-rule:var(--border)}`,
        // Only when no one colour reads on both the callout and a muted tab list (#832).
        ...(solidCallout.tabList
          ? [
              `.nibleaf-site-chrome[data-theme-callouts="solid"]:is([data-theme-tabs="boxed"],[data-theme-tabs="pills"]) [data-theme-component="callout"] [data-theme-component="tabs-list"]{--primary:${solidCallout.tabList}}`,
            ]
          : []),
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

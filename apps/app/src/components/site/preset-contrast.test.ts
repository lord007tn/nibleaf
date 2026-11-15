/**
 * Preset contrast on published sites (PUB-019). axe found two failures on
 * main's presets in light mode: Signal's solid callouts drew dark text on their
 * dark fill (1.05:1), and the code block's language label read 3.81:1 on
 * Manuscript's code chrome.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contrastRatio } from '@nibleaf/shared/themes';
import { describe, expect, it } from 'vitest';
import { projectThemeCss, projectThemeVariables, resolveProjectTheme } from '@/lib/site-theme';

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), 'utf8');

/** sRGB channels of a `#rrggbb` colour. */
const hoverRgb = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
/** WCAG contrast between two sRGB colours, unrounded. */
const hoverContrast = (a: number[], b: number[]) => {
  const linear = (value: number) => {
    const n = value / 255;
    return n <= 0.040_45 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r = 0, g = 0, b = 0]: number[]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** `top` at `alpha` over `base`, as the browser composites `color-mix(…, transparent)` layers. */
const hoverOver = (base: number[], top: number[], alpha: number) => base.map((value, index) => value * (1 - alpha) + (top[index] ?? 0) * alpha);
/** `color-mix(in oklab, a <share>, b)` for opaque colours. */
const hoverMixOklab = (a: number[], b: number[], share: number) => {
  const toLinear = (value: number) => {
    const n = value / 255;
    return n <= 0.040_45 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const fromLinear = (value: number) => 255 * (value <= 0.003_130_8 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
  const toLab = (channels: number[]) => {
    const [r = 0, g = 0, bl = 0] = channels.map(toLinear);
    const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * bl);
    const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * bl);
    const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * bl);
    return [
      0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
      1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
      0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
    ];
  };
  const first = toLab(a);
  const second = toLab(b);
  const [L = 0, A = 0, B = 0] = first.map((value, index) => value * share + (second[index] ?? 0) * (1 - share));
  const l = (L + 0.396_337_777_4 * A + 0.215_803_757_3 * B) ** 3;
  const m = (L - 0.105_561_345_8 * A - 0.063_854_172_8 * B) ** 3;
  const s = (L - 0.089_484_177_5 * A - 1.291_485_548 * B) ** 3;
  return [
    4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
    -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
    -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
  ].map((value) => Math.min(255, Math.max(0, fromLinear(value))));
};

// #731: hover states in the mobile nav drawer, which sits on the popover surface.
// The classes are read from the components, so these cases follow what ships.
describe('drawer hover states (#731)', () => {
  interface DrawerPalette {
    name: string;
    surface: string;
    muted: string;
    foreground: string;
    accent: number[];
    onAccent: string;
  }
  const designSystem = (mode: 'light' | 'dark') => {
    const css = read('../../../../../packages/design-system/src/styles/globals.css');
    const block = css.slice(css.indexOf(mode === 'light' ? ':root {' : '.dark {'));
    const token = (name: string) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1] as string;
    return { surface: token('popover'), muted: token('muted'), foreground: token('foreground') };
  };
  const palettes: DrawerPalette[] = [
    ...(['harbor', 'manuscript', 'signal'] as const).flatMap((preset) =>
      [undefined, '#b96a3d'].flatMap((brand) =>
        (['light', 'dark'] as const).map((mode) => {
          const config = { theme: { preset }, ...(brand ? { styling: { primaryColor: brand } } : {}) } as never;
          const variables = projectThemeVariables(config, mode) as Record<string, string>;
          return {
            name: `${preset}${brand ? ` + ${brand}` : ''} ${mode}`,
            surface: resolveProjectTheme(config).colors[mode].surfaceRaised,
            muted: variables['--muted'] as string,
            foreground: variables['--foreground'] as string,
            accent: hoverRgb(variables['--primary'] as string),
            onAccent: variables['--primary-foreground'] as string,
          };
        }),
      ),
    ),
    // Pre-v1 sites draw on the design system's palette with the brand as accent.
    ...['#5546e8', '#b96a3d'].flatMap((brand) => {
      const css = projectThemeCss({ styling: { primaryColor: brand } } as never);
      const light = css.match(/:root,\.nibleaf-site-chrome\{[^}]*--primary:(#[0-9a-f]{6});--primary-foreground:(#[0-9a-f]{6})/);
      const dark = css.match(
        /:root\.dark,[^{]*\{[^}]*--primary:color-mix\(in oklab,(#[0-9a-f]{6}) (\d+)%,white\);--primary-foreground:(#[0-9a-f]{6})/,
      );
      return [
        { name: `legacy ${brand} light`, ...designSystem('light'), accent: hoverRgb(light?.[1] as string), onAccent: light?.[2] as string },
        {
          name: `legacy ${brand} dark`,
          ...designSystem('dark'),
          accent: hoverMixOklab(hoverRgb(dark?.[1] as string), [255, 255, 255], Number(dark?.[2]) / 100),
          onAccent: dark?.[3] as string,
        },
      ];
    }),
  ];

  const navSource = read('site-nav.tsx');
  const drawerSource = read('mobile-nav-drawer.tsx');
  const tagStart = navSource.indexOf('data-nav-tag');
  const tagClasses = navSource.slice(navSource.lastIndexOf('className', tagStart), tagStart);
  const rowClasses = navSource.match(/'text-muted-foreground hover:[^']*'/)?.[0] ?? '';
  const ctaClasses = drawerSource.match(/className="[^"]*bg-primary [^"]*text-primary-foreground[^"]*"/)?.[0] ?? '';
  const colourOf = (palette: DrawerPalette, token: string) =>
    token === 'foreground' ? hoverRgb(palette.foreground) : token === 'primary' ? palette.accent : undefined;

  it('reads the hover classes it models', () => {
    expect(rowClasses).toMatch(/hover:bg-muted\/\d+/);
    expect(tagClasses).toMatch(/bg-primary\/\d+/);
    expect(tagClasses).toContain('text-primary');
    expect(ctaClasses).not.toBe('');
    // The call to action no longer fades its label with its fill.
    expect(ctaClasses).not.toMatch(/hover:opacity-/);
  });

  it.each(palettes)("keeps an inactive row's tag at AA on hover: $name", (palette) => {
    const wash = Number(rowClasses.match(/hover:bg-muted\/(\d+)/)?.[1]) / 100;
    const tint = Number(tagClasses.match(/bg-primary\/(\d+)/)?.[1]) / 100;
    // The tag's own tint over the row's hover wash over the drawer.
    const hovered = hoverOver(hoverOver(hoverRgb(palette.surface), hoverRgb(palette.muted), wash), palette.accent, tint);
    const hoverText = rowClasses.match(/hover:\[&_\[data-nav-tag\]\]:text-([a-z-]+)/)?.[1] ?? 'primary';
    const text = colourOf(palette, hoverText) as number[];
    expect(text).toBeDefined();
    expect(hoverContrast(text, hovered)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(palettes)('keeps the call-to-action label at AA on hover, with a visible change: $name', (palette) => {
    // The label sits on the far side of the foreground (light on a dark accent,
    // dark on a light one), so a fill moved towards the foreground leaves it.
    expect(contrastRatio(palette.onAccent, palette.foreground)).toBeGreaterThanOrEqual(4.5);
    const label = hoverRgb(palette.onAccent);
    const surface = hoverRgb(palette.surface);
    const resting = hoverContrast(label, palette.accent);
    const opacity = ctaClasses.match(/hover:opacity-(\d+)/)?.[1];
    const mixed = ctaClasses.match(/hover:bg-\[color-mix\(in_oklab,var\(--primary\)_(\d+)%,var\(--foreground\)\)\]/)?.[1];
    let hovered: number;
    let fill: number[];
    if (opacity) {
      // The whole button fades over the drawer: label and fill alike.
      const alpha = Number(opacity) / 100;
      fill = hoverOver(surface, palette.accent, alpha);
      hovered = hoverContrast(hoverOver(surface, label, alpha), fill);
    } else {
      expect(mixed).toBeDefined();
      fill = hoverMixOklab(palette.accent, hoverRgb(palette.foreground), Number(mixed) / 100);
      hovered = hoverContrast(label, fill);
    }
    expect(hovered).toBeGreaterThanOrEqual(4.5);
    // Moving the fill away from its label only gains contrast.
    expect(hovered).toBeGreaterThanOrEqual(resting);
    // And the hover stays visible: the fill shifts by a noticeable step.
    expect(hoverContrast(fill, palette.accent)).toBeGreaterThan(1.1);
  });
});

describe('preset contrast (PUB-019)', () => {
  it('renders a solid callout in the dark palette, so its text and anything nested in it read as in dark mode', () => {
    const config = { theme: { preset: 'signal' } } as never;
    const css = projectThemeCss(config);
    const island = css.match(/\.nibleaf-site-chrome\[data-theme-callouts="solid"\] \[data-theme-component="callout"\]\{([^}]*)\}/)?.[1] ?? '';
    const darkTokens = css.match(/:root\.dark,:root\.dark \.nibleaf-site-chrome,\.nibleaf-site-chrome\.dark\{([^}]*)\}/)?.[1] ?? '';
    expect(island).not.toBe('');
    expect(darkTokens).not.toBe('');
    // The same tokens dark mode uses (foreground, muted, card, background, …), then the code accent for links.
    expect(island.startsWith(darkTokens)).toBe(true);
    // Links keep the code accent, and the typeset values the outer .typeset derived
    // from the light palette (h5/h6 colour, rules) are derived again inside.
    expect(island.endsWith(';--primary:var(--theme-code-accent);--typeset-muted:var(--muted-foreground);--typeset-rule:var(--border)')).toBe(true);
    // Every typeset variable derived from a palette alias must be rebound here.
    const derived = [
      ...read('../../typeset.css').matchAll(
        /(--typeset-[a-z-]+):\s*var\(\s*--(?:foreground|muted-foreground|border|muted|primary|background|card)\b/g,
      ),
    ].map((m) => m[1]);
    expect(derived.length).toBeGreaterThan(0);
    for (const name of derived) expect(island).toContain(`${name}:`);
    // The stylesheet's solid-callout rule doesn't remap the aliases itself.
    const styles = read('../../styles.css');
    const start = styles.indexOf('[data-theme-callouts="solid"]');
    expect(styles.slice(start, styles.indexOf('}', start))).not.toContain('--foreground:');
  });

  it('leaves pre-v1 sites, which have no theme or solid callouts, without the rule', () => {
    expect(projectThemeCss({ styling: { primaryColor: '#5546e8' } } as never)).not.toContain('[data-theme-callouts="solid"]');
  });

  it("draws the code block's language label at a contrast that reads on the dark chrome", () => {
    expect(read('reader-code-block.tsx')).toContain('font-mono text-[10px] text-white/70 uppercase');
  });
});

/** Contrast of `color` on `layers` stacked tints of itself (each `weight` alpha)
 * over `background`, composited in sRGB with unrounded channels. */
const onStackedTint = (color: string, background: string, weight: number, layers: number) => {
  const rgb = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  const linear = (value: number) => {
    const n = value / 255;
    return n <= 0.040_45 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r = 0, g = 0, b = 0]: number[]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const text = rgb(color);
  let surface = rgb(background);
  for (let layer = 0; layer < layers; layer++) surface = surface.map((value, index) => value * (1 - weight) + (text[index] ?? 0) * weight);
  const [a, b] = [luminance(text), luminance(surface)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

// #678: an active nav row draws `bg-primary/10`, and a tag inside it used to add
// its own, so the tag's 10px accent text sat on a stacked tint of about 19% while
// the accent shade is chosen to read on one 10% tint. The tag now drops its own
// tint while its row is active (site-nav.test.tsx checks the classes).
describe('the tag on an active nav row (#678)', () => {
  const cases = (['harbor', 'manuscript', 'signal'] as const).flatMap((preset) =>
    [undefined, '#b96a3d'].flatMap((brand) => (['light', 'dark'] as const).map((mode) => ({ preset, brand, mode }))),
  );

  /** The tag's text and the surface its row sits on. Signal's rail is drawn on
   *  the code surface, where `--primary` is the code accent. */
  const tagColors = ({ preset, brand, mode }: (typeof cases)[number]) => {
    const config = { theme: { preset }, ...(brand ? { styling: { primaryColor: brand } } : {}) } as never;
    const variables = projectThemeVariables(config, mode) as Record<string, string>;
    const tokens = resolveProjectTheme(config).colors[mode];
    return preset === 'signal'
      ? { text: variables['--theme-code-accent'] as string, surface: tokens.code }
      : { text: variables['--primary'] as string, surface: tokens.canvas };
  };

  it.each(cases)('reads at AA on the row tint alone: $preset $mode, brand $brand', (theme) => {
    const { text, surface } = tagColors(theme);
    expect(onStackedTint(text, surface, 0.1, 1)).toBeGreaterThanOrEqual(4.5);
  });

  it('fell short on the stacked tint the tag used to add (Harbor with #b96a3d: 4.54:1 on the row, 4.01:1 stacked)', () => {
    const { text, surface } = tagColors({ preset: 'harbor', brand: '#b96a3d', mode: 'light' });
    expect(text).toBe('#9d5a34');
    expect(onStackedTint(text, surface, 0.1, 1)).toBeGreaterThanOrEqual(4.5);
    expect(onStackedTint(text, surface, 0.1, 2)).toBeLessThan(4.5);
  });

  it.each(['#5546e8', '#b96a3d'])('reads at AA on a pre-v1 light row with brand %s', (brand) => {
    const css = projectThemeCss({ styling: { primaryColor: brand } } as never);
    const text = css.match(/:root,\.nibleaf-site-chrome\{[^}]*--primary:(#[0-9a-f]{6})/)?.[1] as string;
    expect(text).toMatch(/^#[0-9a-f]{6}$/);
    expect(onStackedTint(text, '#fafafa', 0.1, 1)).toBeGreaterThanOrEqual(4.5);
  });
});

/** `color-mix(in oklab, <brand> 72%, white)`, the pre-v1 dark accent, as the
 * browser computes it (opaque colours, so no premultiplication). */
const legacyDarkAccent = (brand: string): string => {
  const toLinear = (value: number) => {
    const n = value / 255;
    return n <= 0.040_45 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const fromLinear = (value: number) => 255 * (value <= 0.003_130_8 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
  const oklab = (hex: string) => {
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => toLinear(Number.parseInt(hex.slice(start, start + 2), 16)));
    const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b);
    const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b);
    const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b);
    return [
      0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
      1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
      0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
    ];
  };
  const brandLab = oklab(brand);
  const whiteLab = oklab('#ffffff');
  const [L = 0, A = 0, B = 0] = brandLab.map((value, index) => value * 0.72 + (whiteLab[index] ?? 0) * 0.28);
  const l = (L + 0.396_337_777_4 * A + 0.215_803_757_3 * B) ** 3;
  const m = (L - 0.105_561_345_8 * A - 0.063_854_172_8 * B) ** 3;
  const s = (L - 0.089_484_177_5 * A - 1.291_485_548 * B) ** 3;
  const channels = [
    4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
    -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
    -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
  ];
  return `#${channels
    .map((value) =>
      Math.round(Math.min(255, Math.max(0, fromLinear(value))))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

// #726: the mobile drawer is a popover on the raised surface (`bg-popover`),
// not the canvas the accent is shaded for. Its active rows (the page tree's
// title and tag, and an active header link) draw `text-primary` on
// `bg-primary/10`, and its call to action draws `text-primary-foreground` on
// `bg-primary`; all of them must read there too.
describe('the active row in the mobile drawer (#726)', () => {
  const cases = (['harbor', 'manuscript', 'signal'] as const).flatMap((preset) =>
    [undefined, '#b96a3d'].flatMap((brand) => (['light', 'dark'] as const).map((mode) => ({ preset, brand, mode }))),
  );
  const configFor = ({ preset, brand }: { preset: string; brand?: string }) =>
    ({ theme: { preset }, ...(brand ? { styling: { primaryColor: brand } } : {}) }) as never;
  const DARK_DRAWER = ':root.dark [data-site-drawer],.nibleaf-site-chrome.dark [data-site-drawer]{';
  const drawerRule = (css: string, mode: 'light' | 'dark') => {
    const opener = mode === 'light' ? '}[data-site-drawer]{' : DARK_DRAWER;
    const start = css.indexOf(opener);
    return start < 0 ? undefined : css.slice(start + opener.length, css.indexOf('}', start + opener.length));
  };
  /** What the drawer draws: its own shade when the theme scopes one, else the page's accent. */
  const drawerColors = (theme: (typeof cases)[number]) => {
    const config = configFor(theme);
    const variables = projectThemeVariables(config, theme.mode) as Record<string, string>;
    const rule = drawerRule(projectThemeCss(config), theme.mode);
    return {
      text: rule?.match(/--primary:(#[0-9a-f]{6})/)?.[1] ?? (variables['--primary'] as string),
      onAccent: rule?.match(/--primary-foreground:(#[0-9a-f]{6})/)?.[1] ?? (variables['--primary-foreground'] as string),
      surface: resolveProjectTheme(config).colors[theme.mode].surfaceRaised,
      pageAccent: variables['--primary'] as string,
    };
  };

  it.each(cases)('reads at AA on the raised surface: $preset $mode, brand $brand', (theme) => {
    const { text, onAccent, surface } = drawerColors(theme);
    expect(onStackedTint(text, surface, 0.1, 1)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(onAccent, text)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['harbor', 3.81],
    ['manuscript', 3.84],
    ['signal', 3.92],
  ] as const)('fell short in dark with #b96a3d on %s (%s:1 with the canvas shade)', (preset, before) => {
    const { text, surface, pageAccent } = drawerColors({ preset, brand: '#b96a3d', mode: 'dark' });
    expect(onStackedTint(pageAccent, surface, 0.1, 1)).toBeCloseTo(before, 2);
    expect(text).not.toBe(pageAccent);
    expect(onStackedTint(text, surface, 0.1, 1)).toBeGreaterThanOrEqual(4.5);
  });

  it('scopes the shade to the drawer and leaves the page, the rail and the presets as they were', () => {
    // Every preset's own accent already reads in the drawer: no rule, CSS unchanged.
    for (const preset of ['harbor', 'manuscript', 'signal'] as const)
      expect(projectThemeCss(configFor({ preset }))).not.toContain('data-site-drawer');
    const config = configFor({ preset: 'harbor', brand: '#b96a3d' });
    const css = projectThemeCss(config);
    const light = drawerRule(css, 'light');
    const dark = drawerRule(css, 'dark');
    // The drawer rules come last and only rebind the accent and the text on it.
    expect(css.endsWith(`}[data-site-drawer]{${light}}${DARK_DRAWER}${dark}}`)).toBe(true);
    for (const rule of [light, dark]) expect(rule).toMatch(/^--primary:#[0-9a-f]{6};--primary-foreground:#[0-9a-f]{6}$/);
    // Light needs no shade (4.66:1 on white), so it keeps the page's accent.
    const lightVariables = projectThemeVariables(config, 'light') as Record<string, string>;
    expect(light).toBe(`--primary:${lightVariables['--primary']};--primary-foreground:${lightVariables['--primary-foreground']}`);
    // The page keeps its canvas shade and the rail its code accent.
    const darkVariables = projectThemeVariables(config, 'dark') as Record<string, string>;
    expect(darkVariables['--primary']).toBe('#bd7147');
    expect(dark).not.toContain('#bd7147');
    const pageDark = css.slice(css.indexOf(':root.dark,:root.dark .nibleaf-site-chrome,.nibleaf-site-chrome.dark{'));
    expect(pageDark.slice(0, pageDark.indexOf('}'))).toContain(`--theme-code-accent:${darkVariables['--theme-code-accent']};`);
    expect(pageDark.slice(0, pageDark.indexOf('}'))).toContain('--primary:#bd7147;');
  });

  it.each(['#5546e8', '#b96a3d'])('reads on the pre-v1 popover in light (#ffffff) and dark (#171717) with brand %s, with no drawer rule', (brand) => {
    const css = projectThemeCss({ styling: { primaryColor: brand } } as never);
    expect(css).not.toContain('data-site-drawer');
    const light = css.match(/:root,\.nibleaf-site-chrome\{[^}]*--primary:(#[0-9a-f]{6})/)?.[1] as string;
    expect(onStackedTint(light, '#ffffff', 0.1, 1)).toBeGreaterThanOrEqual(4.5);
    // Dark draws the brand mixed towards white; the drawer sits on the design system's #171717 popover.
    expect(css).toContain(`--primary:color-mix(in oklab,${brand} 72%,white)`);
    const dark = legacyDarkAccent(brand);
    expect(onStackedTint(dark, '#171717', 0.1, 1)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#171717', dark)).toBeGreaterThanOrEqual(4.5);
  });
});

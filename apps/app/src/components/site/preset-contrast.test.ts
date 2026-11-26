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

/** The drawer's own accent rule, which projectThemeCss emits (scoped to
 * `[data-site-drawer]`) when a mode's canvas shade doesn't read on the raised
 * surface (#726); undefined when the drawer keeps the page's accent. */
const DARK_DRAWER = ':root.dark [data-site-drawer],.nibleaf-site-chrome.dark [data-site-drawer]{';
const drawerRule = (css: string, mode: 'light' | 'dark') => {
  const opener = mode === 'light' ? '}[data-site-drawer]{' : DARK_DRAWER;
  const start = css.indexOf(opener);
  return start < 0 ? undefined : css.slice(start + opener.length, css.indexOf('}', start + opener.length));
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
          // Inside the drawer, its scoped shade replaces the page's accent when the theme emits one.
          const rule = drawerRule(projectThemeCss(config), mode);
          return {
            name: `${preset}${brand ? ` + ${brand}` : ''} ${mode}`,
            surface: resolveProjectTheme(config).colors[mode].surfaceRaised,
            muted: variables['--muted'] as string,
            foreground: variables['--foreground'] as string,
            accent: hoverRgb(rule?.match(/--primary:(#[0-9a-f]{6})/)?.[1] ?? (variables['--primary'] as string)),
            onAccent: rule?.match(/--primary-foreground:(#[0-9a-f]{6})/)?.[1] ?? (variables['--primary-foreground'] as string),
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

  it("models the drawer's own accent where the theme scopes one, not the page's", () => {
    for (const preset of ['harbor', 'manuscript', 'signal'] as const) {
      const config = { theme: { preset }, styling: { primaryColor: '#b96a3d' } } as never;
      const shade = drawerRule(projectThemeCss(config), 'dark')?.match(/--primary:(#[0-9a-f]{6})/)?.[1] as string;
      const palette = palettes.find((candidate) => candidate.name === `${preset} + #b96a3d dark`);
      expect(shade).toMatch(/^#[0-9a-f]{6}$/);
      expect(shade).not.toBe((projectThemeVariables(config, 'dark') as Record<string, string>)['--primary']);
      expect(palette?.accent).toEqual(hoverRgb(shade));
    }
  });

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

  // #682: a tab list nested in a solid callout draws its active label in
  // `text-primary` (the callout's code accent) on the list's muted fill, which is
  // lighter than the code surface that accent is shaded for. #b96a3d on Signal
  // gave #bb6e42: 4.09:1 on #1e2230.
  it('keeps the labels of a tab list nested in a solid callout readable, for every preset and brand (#682)', () => {
    // What ships: the active label and indicator use --primary, the others the
    // muted text, on the boxed and pill lists' muted fill (or the callout's own).
    const tabs = read('mdx/tabs.tsx');
    expect(tabs).toContain("i === active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground");
    const styles = read('../../styles.css');
    for (const variant of ['boxed', 'pills']) {
      const start = styles.search(new RegExp(`\\[data-theme-tabs="${variant}"\\]\\s+\\[data-theme-component="tabs-list"\\]`));
      expect(start).toBeGreaterThan(0);
      expect(styles.slice(start, styles.indexOf('}', start))).toContain('background: var(--theme-muted)');
    }
    const islandOf = (css: string) => {
      const body = css.match(/\.nibleaf-site-chrome\[data-theme-callouts="solid"\] \[data-theme-component="callout"\]\{([^}]*)\}/)?.[1] ?? '';
      // Later declarations win, as in the browser.
      return new Map(
        body.split(';').map((declaration) => [declaration.slice(0, declaration.indexOf(':')), declaration.slice(declaration.indexOf(':') + 1)]),
      );
    };
    const presets = ['harbor', 'manuscript', 'signal'] as const;
    const brands = ['#b96a3d', '#5546e8', '#2d25e3', '#3a1408', '#000000', '#0b7a55', '#ffcc00', '#e11d48'];
    const configs = presets.flatMap((preset) => [
      { theme: { preset, components: { callouts: 'solid' } } },
      ...brands.flatMap((brand) => [
        { theme: { preset, components: { callouts: 'solid' }, colors: { light: { accent: brand }, dark: { accent: brand } } } },
        { theme: { preset, components: { callouts: 'solid' } }, styling: { primaryColor: brand } },
      ]),
    ]);
    const failures: string[] = [];
    for (const config of configs) {
      const island = islandOf(projectThemeCss(config as never));
      const raw = island.get('--primary') ?? '';
      const primary = raw === 'var(--theme-code-accent)' ? (island.get('--theme-code-accent') ?? '') : raw;
      const muted = island.get('--theme-muted') ?? '';
      const code = island.get('--theme-code') ?? '';
      const fills = [
        ['tab list', hoverRgb(muted)],
        ...(['info', 'success', 'warning', 'danger'] as const).map(
          (tone) => [`${tone} callout`, hoverMixOklab(hoverRgb(island.get(`--theme-${tone}`) ?? ''), hoverRgb(code), 0.14)] as const,
        ),
      ] as const;
      const label = JSON.stringify(config);
      for (const [name, fill] of fills) {
        const active = hoverContrast(hoverRgb(primary), [...fill]);
        if (active < 4.5) failures.push(`${label}: active label ${primary} on the ${name} ${active.toFixed(2)}:1`);
      }
      const inactive = hoverContrast(hoverRgb(island.get('--muted-foreground') ?? ''), hoverRgb(muted));
      if (inactive < 4.5) failures.push(`${label}: inactive label on the tab list ${inactive.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
    // Signal as shipped keeps the code accent itself: its CSS doesn't change.
    expect(islandOf(projectThemeCss({ theme: { preset: 'signal' } } as never)).get('--primary')).toBe('var(--theme-code-accent)');
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

// #832: the shade search for a solid callout's --primary (#682) walks 40 steps
// from the code accent towards white (black on a light code surface). Surface
// overrides that put the tab list's muted fill on the far side of the code
// surface leave no step that reads on every fill, and main then kept the code
// accent. When no searched shade reaches the required 4.51 margin on every
// fill, the callout and a boxed or pill tab list (the ones that draw the muted
// fill) each get their own nearest readable shade.
describe("a solid callout's --primary when no shade of the code accent reads on every fill (#832)", () => {
  const ISLAND = '.nibleaf-site-chrome[data-theme-callouts="solid"] [data-theme-component="callout"]{';
  const TAB_LIST =
    '.nibleaf-site-chrome[data-theme-callouts="solid"]:is([data-theme-tabs="boxed"],[data-theme-tabs="pills"]) [data-theme-component="callout"] [data-theme-component="tabs-list"]{';
  const ruleBody = (css: string, opener: string) => {
    const start = css.indexOf(opener);
    return start < 0 ? undefined : css.slice(start + opener.length, css.indexOf('}', start + opener.length));
  };
  /** A rule's declarations; later ones win, as in the browser. */
  const declarations = (body: string) =>
    new Map(body.split(';').map((declaration) => [declaration.slice(0, declaration.indexOf(':')), declaration.slice(declaration.indexOf(':') + 1)]));
  const calloutOf = (config: unknown) => {
    const css = projectThemeCss(config as never);
    const island = declarations(ruleBody(css, ISLAND) ?? '');
    const resolve = (value: string) => (value.startsWith('var(') ? (island.get(value.slice('var('.length, -1)) ?? '') : value);
    const tabListRule = ruleBody(css, TAB_LIST);
    const code = hoverRgb(island.get('--theme-code') ?? '');
    const calloutFills = (['info', 'success', 'warning', 'danger'] as const).map(
      (tone) => [`${tone} callout`, hoverMixOklab(hoverRgb(island.get(`--theme-${tone}`) ?? ''), code, 0.14)] as const,
    );
    const primary = resolve(island.get('--primary') ?? '');
    return {
      raw: island.get('--primary') ?? '',
      primary,
      // A boxed or pill tab list takes its own --primary where the CSS sets one.
      tabList: tabListRule === undefined ? primary : resolve(declarations(tabListRule).get('--primary') ?? ''),
      tabListRule,
      codeAccent: island.get('--theme-code-accent') ?? '',
      muted: hoverRgb(island.get('--theme-muted') ?? ''),
      calloutFills,
    };
  };
  const toHex = (channels: number[]) => `#${channels.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
  /** Links and an underline tab list's labels sit on the callout fills; a boxed or pill
   * tab list's labels sit on its muted fill. */
  const shortfalls = (config: unknown) => {
    const { primary, tabList, muted, calloutFills } = calloutOf(config);
    const label = JSON.stringify(config);
    const found: string[] = [];
    for (const [name, fill] of calloutFills) {
      const ratio = hoverContrast(hoverRgb(primary), [...fill]);
      if (ratio < 4.5) found.push(`${label}: --primary ${primary} on the ${name} ${ratio.toFixed(2)}:1`);
    }
    const ratio = hoverContrast(hoverRgb(tabList), muted);
    if (ratio < 4.5) found.push(`${label}: the boxed or pill tab list's --primary ${tabList} on its muted fill ${ratio.toFixed(2)}:1`);
    return found;
  };
  // A white tab list in a black callout: Signal's dark palette with two surfaces overridden.
  const conflicting = { theme: { preset: 'signal', components: { callouts: 'solid' }, colors: { dark: { code: '#000000', muted: '#ffffff' } } } };

  /** WCAG relative luminance of unrounded sRGB channels. */
  const luminanceOf = (channels: number[]) => {
    const linear = (value: number) => {
      const n = value / 255;
      return n <= 0.040_45 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    };
    const [r = 0, g = 0, b = 0] = channels;
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  /** The text luminances in [0, 1] that reach `ratio` on every fill: a fill of luminance f
   * allows text at or below (f + 0.05) / ratio - 0.05, or at or above ratio * (f + 0.05) - 0.05. */
  const readableLuminances = (fills: number[][], ratio: number) =>
    fills
      .map(luminanceOf)
      .reduce<Array<readonly [number, number]>>(
        (allowed, f) =>
          allowed
            .flatMap(([low, high]) => [
              [low, Math.min(high, (f + 0.05) / ratio - 0.05)] as const,
              [Math.max(low, ratio * (f + 0.05) - 0.05), high] as const,
            ])
            .filter(([low, high]) => low <= high),
        [[0, 1]],
      );

  it('runs out of shades with a white tab list in a black callout, where no colour reads on all five fills with the margin', () => {
    const { codeAccent, muted, calloutFills } = calloutOf(conflicting);
    const fills = [muted, ...calloutFills.map(([, fill]) => [...fill])];
    const weakest = (hex: string) => Math.min(...fills.map((fill) => hoverContrast(hoverRgb(hex), fill)));
    // The code accent reads on the callout fills, not on the white tab list.
    expect(codeAccent).toBe('#ab99ff');
    expect(hoverContrast(hoverRgb(codeAccent), muted)).toBeLessThan(2.5);
    // Each of the 40 steps towards white is lighter still, so none reads on the tab list.
    const steps = Array.from({ length: 40 }, (_, index) => toHex(hoverMixOklab(hoverRgb(codeAccent), [255, 255, 255], 1 - (index + 1) / 40)));
    expect(steps.filter((shade) => weakest(shade) >= 4.5)).toEqual([]);
    // Nor does any other colour, at the 4.51 the search requires (4.5 plus #744's 0.01
    // margin). Contrast depends only on luminance, and every sRGB colour's luminance is
    // in [0, 1], so an empty window of luminances rules out every colour, not just greys.
    expect(readableLuminances(fills, 4.51)).toEqual([]);
    // At exactly 4.5:1 a sliver remains: #757776 reads 4.5096:1 on its weakest fill, and
    // the best any colour can do is the geometric mean of the lightest dark fill and the
    // white tab list, about 4.5097:1. Both are below the margin.
    expect(readableLuminances(fills, 4.5)).not.toEqual([]);
    expect(weakest('#757776')).toBeCloseTo(4.5096, 4);
    const lightestCalloutFill = Math.max(...calloutFills.map(([, fill]) => luminanceOf([...fill])));
    const optimum = Math.sqrt((luminanceOf(muted) + 0.05) / (lightestCalloutFill + 0.05));
    expect(optimum).toBeCloseTo(4.5097, 4);
    expect(optimum).toBeLessThan(4.51);
  });

  it('gives the callout and a boxed or pill tab list each a shade of the code accent that reads there', () => {
    const { raw, tabListRule } = calloutOf(conflicting);
    // main kept var(--theme-code-accent) for both, with no tab list rule: #ab99ff on the white tab list.
    expect(raw).toBe('var(--theme-code-accent)');
    expect(tabListRule).toBe('--primary:#796bb6');
    expect(shortfalls(conflicting)).toEqual([]);
  });

  it('keeps every fill at 4.5:1 or more for conflicting surfaces, and adds the tab list rule only where the search runs out', () => {
    // A light tab list on a dark code surface, and the mirror: a dark one on a light code surface.
    const surfaces = [
      ...['#ffffff', '#f5f5f5', '#e2e8f0', '#d4d4d4', '#bfbfbf', '#a3a3a3', '#8a8a8a', '#fde68a', '#bae6fd'].flatMap((muted) =>
        ['#000000', '#050609', '#0d1117', '#1e293b'].map((code) => ({ code, muted })),
      ),
      ...['#000000', '#1e2230', '#334155', '#5b5b5b'].flatMap((muted) => ['#ffffff', '#f8fafc', '#fef3c7'].map((code) => ({ code, muted }))),
    ];
    const conflictingConfigs = (['harbor', 'manuscript', 'signal'] as const).flatMap((preset) =>
      surfaces.flatMap(({ code, muted }) =>
        [undefined, '#b96a3d', '#5546e8'].map((brand) => ({
          theme: { preset, components: { callouts: 'solid' }, colors: { dark: { code, muted } } },
          ...(brand ? { styling: { primaryColor: brand } } : {}),
        })),
      ),
    );
    expect(conflictingConfigs.flatMap(shortfalls)).toEqual([]);
    expect(conflictingConfigs.filter((config) => calloutOf(config).tabListRule !== undefined).length).toBeGreaterThan(0);
    // The presets, as shipped and with a brand, never run out: one --primary and no extra rule.
    const shipped = (['harbor', 'manuscript', 'signal'] as const).flatMap((preset) =>
      [undefined, '#b96a3d', '#5546e8', '#2d25e3', '#3a1408', '#000000', '#0b7a55', '#ffcc00', '#e11d48'].map((brand) => ({
        theme: { preset, components: { callouts: 'solid' } },
        ...(brand ? { styling: { primaryColor: brand } } : {}),
      })),
    );
    expect(shipped.filter((config) => calloutOf(config).tabListRule !== undefined)).toEqual([]);
  });

  it('adds no tab list rule where a shade reads on every fill, even with overridden surfaces', () => {
    const config = {
      theme: { preset: 'signal', components: { callouts: 'solid' }, colors: { dark: { muted: '#2b3145' } } },
      styling: { primaryColor: '#b96a3d' },
    };
    const { raw, tabListRule } = calloutOf(config);
    // The #682 search found a shade, so there is one --primary and nothing else.
    expect(raw).toMatch(/^#[0-9a-f]{6}$/);
    expect(tabListRule).toBeUndefined();
    expect(projectThemeCss(config as never)).not.toContain('tabs-list');
  });

  it('scopes the tab list rule to boxed and pill tab lists inside a solid callout', () => {
    const css = projectThemeCss(conflicting as never);
    // One rule names the tab list, and it is the scoped one: not underline tab lists,
    // not tab lists outside a callout, not the drawer.
    expect(css.split('[data-theme-component="tabs-list"]').length - 1).toBe(1);
    expect(css).toContain(TAB_LIST);
    expect(TAB_LIST).not.toMatch(/underline|data-site-drawer/);
  });
});

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

// #744: pre-v1 dark mode mixes the brand 72% towards white and the code accent
// 55%. For a dark brand neither mix reads (#000000 gave #292929, 1.36:1 on the
// #0a0a0a canvas), so those values become the nearest shade that does, while
// every brand that already read keeps the CSS it shipped, byte for byte.
describe('pre-v1 dark mode with a dark brand (#744)', () => {
  const CANVAS = '#0a0a0a';
  const POPOVER = '#171717';
  const CODE = '#0d1117';
  const toHex = (channels: number[]) => `#${channels.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
  /** A declared colour as the browser draws it, as sRGB channels: a `color-mix(in oklab,…,white)`
   * worked out independently and left UNROUNDED (the browser keeps the fraction), or a hex. */
  const drawn = (value: string): number[] => {
    const mix = value.match(/^color-mix\(in oklab,(#[0-9a-f]{6}) (\d+)%,white\)$/);
    return mix ? hoverMixOklab(hoverRgb(mix[1] as string), [255, 255, 255], Number(mix[2]) / 100) : hoverRgb(value);
  };
  /** Contrast on the colour's own `weight` tint over `background`, composited without rounding. */
  const onOwnTint = (color: number[], background: string, weight = 0.1) => hoverContrast(color, hoverOver(hoverRgb(background), color, weight));
  const declarations = (rule: string): Record<string, string> =>
    Object.fromEntries(
      rule.split(';').map((declaration) => [declaration.slice(0, declaration.indexOf(':')), declaration.slice(declaration.indexOf(':') + 1)]),
    );
  const legacyDark = (brand: string) => {
    const css = projectThemeCss({ styling: { primaryColor: brand } } as never);
    const opener = ':root.dark,:root.dark .nibleaf-site-chrome,.nibleaf-site-chrome.dark{';
    const start = css.indexOf(opener) + opener.length;
    const page = declarations(css.slice(start, css.indexOf('}', start)));
    const light = declarations(css.slice(css.indexOf('{') + 1, css.indexOf('}')));
    const drawer = drawerRule(css, 'dark');
    const drawerTokens = drawer ? declarations(drawer) : {};
    return {
      css,
      page,
      light,
      primary: drawn(page['--primary'] as string),
      onPrimary: hoverRgb(page['--primary-foreground'] as string),
      drawerPrimary: drawn(drawerTokens['--primary'] ?? (page['--primary'] as string)),
      drawerOnPrimary: hoverRgb(drawerTokens['--primary-foreground'] ?? (page['--primary-foreground'] as string)),
      codeAccent: drawn(light['--theme-code-accent'] as string),
    };
  };
  /** Every target in #744 the brand misses, with its ratio (empty when it meets them all), on fractional channels. */
  const shortfalls = (brand: string) => {
    const dark = legacyDark(brand);
    const [canvas, popover, code] = [CANVAS, POPOVER, CODE].map(hoverRgb) as [number[], number[], number[]];
    const checks: [string, number, number][] = [
      ['--primary on the canvas', hoverContrast(dark.primary, canvas), 4.5],
      ['--primary on its tint', onOwnTint(dark.primary, CANVAS), 4.5],
      ['--ring on the canvas', hoverContrast(drawn(dark.page['--ring'] as string), canvas), 3],
      ['--theme-focus on the canvas', hoverContrast(drawn(dark.page['--theme-focus'] as string), canvas), 3],
      ['--primary-foreground on --primary', hoverContrast(dark.onPrimary, dark.primary), 4.5],
      ['drawer --primary on the popover', hoverContrast(dark.drawerPrimary, popover), 4.5],
      ['drawer --primary on its tint', onOwnTint(dark.drawerPrimary, POPOVER), 4.5],
      ['drawer --primary-foreground on its --primary', hoverContrast(dark.drawerOnPrimary, dark.drawerPrimary), 4.5],
      ['--theme-code-accent on the code surface', hoverContrast(dark.codeAccent, code), 4.5],
    ];
    return checks.filter(([, ratio, target]) => ratio < target).map(([name, ratio]) => `${name}: ${ratio.toFixed(4)}:1`);
  };
  /** The tint as the browser stores it: composited, then rounded to 8 bits a channel. */
  const roundedTint = (color: number[], background: string) => hoverOver(hoverRgb(background), color, 0.1).map(Math.round);
  /** Every target a HEX replacement misses by the margin a kept mix needs (4.51:1), on the tint both as
   * composited and rounded (#758); a `color-mix()` that was kept is judged by `shortfalls` and the sweep. */
  const replacementShortfalls = (brand: string) => {
    const dark = legacyDark(brand);
    const drawer = drawerRule(dark.css, 'dark');
    const drawerTokens = drawer ? declarations(drawer) : {};
    const isHex = (value: string | undefined) => /^#[0-9a-f]{6}$/.test(value ?? '');
    const checks: [string, number][] = [];
    const asText = (name: string, color: number[], background: string, onAccent: number[]) =>
      checks.push(
        [`${name} on ${background}`, hoverContrast(color, hoverRgb(background))],
        [`${name} on its tint`, onOwnTint(color, background)],
        [`${name} on its tint, rounded`, hoverContrast(color, roundedTint(color, background))],
        [`text on ${name}`, hoverContrast(onAccent, color)],
      );
    if (isHex(dark.page['--primary'])) asText('--primary', dark.primary, CANVAS, dark.onPrimary);
    if (isHex(drawerTokens['--primary'] ?? dark.page['--primary'])) asText('drawer --primary', dark.drawerPrimary, POPOVER, dark.drawerOnPrimary);
    if (isHex(dark.light['--theme-code-accent']))
      checks.push(['--theme-code-accent on the code surface', hoverContrast(dark.codeAccent, hoverRgb(CODE))]);
    return checks.filter(([, ratio]) => ratio < 4.51).map(([name, ratio]) => `${name}: ${ratio.toFixed(4)}:1`);
  };

  it.each([
    ['#000000', 1.36],
    ['#111111', 2.23],
    ['#0b3d91', 4.17],
    ['#1a1a2e', 2.58],
    ['#14532d', 4.41],
  ])('reads everywhere it is drawn with brand %s (the mix gave %s:1 on the canvas)', (brand, before) => {
    expect(contrastRatio(legacyDarkAccent(brand), CANVAS)).toBeCloseTo(before, 2);
    expect(shortfalls(brand)).toEqual([]);
    const dark = legacyDark(brand);
    // One shade, in place of the mix, for the accent, info and focus.
    for (const token of ['--theme-accent', '--theme-info', '--theme-focus', '--ring']) expect(dark.page[token], token).toBe(dark.page['--primary']);
    expect(dark.page['--primary']).toMatch(/^#[0-9a-f]{6}$/);
    expect(dark.page['--theme-accent-foreground']).toBe(dark.page['--primary-foreground']);
  });

  // The browser keeps a mix's fractional channels; rounding them first can lift a
  // colour just under AA over the line. These two did, and kept their mix.
  it('judges a mix by its unrounded colour: #2d25e3 read 4.5003:1 on its tint rounded, 4.4760:1 as drawn', () => {
    const fractional = hoverMixOklab(hoverRgb('#2d25e3'), [255, 255, 255], 0.72);
    expect(toHex(fractional)).toBe('#5874f1');
    expect(onOwnTint(hoverRgb('#5874f1'), CANVAS)).toBeCloseTo(4.5003, 4);
    expect(onOwnTint(fractional, CANVAS)).toBeCloseTo(4.476, 4);
    const dark = legacyDark('#2d25e3');
    expect(dark.page['--primary']).toMatch(/^#[0-9a-f]{6}$/);
    expect(shortfalls('#2d25e3')).toEqual([]);
  });

  it("judges the code accent the same way: #3a1408's 55% mix read 4.5041:1 rounded, 4.4812:1 as drawn", () => {
    const fractional = hoverMixOklab(hoverRgb('#3a1408'), [255, 255, 255], 0.55);
    expect(hoverContrast(hoverRgb(toHex(fractional)), hoverRgb(CODE))).toBeCloseTo(4.5041, 4);
    expect(hoverContrast(fractional, hoverRgb(CODE))).toBeCloseTo(4.4812, 4);
    const dark = legacyDark('#3a1408');
    expect(dark.light['--theme-code-accent']).toMatch(/^#[0-9a-f]{6}$/);
    expect(shortfalls('#3a1408')).toEqual([]);
  });

  // #753 held a replacement hex to 4.5:1 exactly, and the active row's tint is rounded when drawn (#758).
  it.each([
    ['#2d25e3', ['--primary on its tint: 4.5003:1', '--primary on its tint, rounded: 4.4879:1']],
    [
      '#490000',
      ['text on --primary: 4.5069:1', 'drawer --primary on its tint, rounded: 4.4933:1', '--theme-code-accent on the code surface: 4.5056:1'],
    ],
    ['#3a1408', ['--theme-code-accent on the code surface: 4.5041:1']],
  ] as const)('gives the hex replacements for %s a margin over 4.5:1 on every target (before: %j)', (brand, _before) => {
    expect(replacementShortfalls(brand)).toEqual([]);
    expect(shortfalls(brand)).toEqual([]);
  });

  it("checks #2d25e3's replacement on the tint as the browser rounds it: #5874f1 read 4.4879:1 on [18, 21, 33]", () => {
    expect(roundedTint(hoverRgb('#5874f1'), CANVAS)).toEqual([18, 21, 33]);
    expect(hoverContrast(hoverRgb('#5874f1'), roundedTint(hoverRgb('#5874f1'), CANVAS))).toBeCloseTo(4.4879, 4);
    const dark = legacyDark('#2d25e3');
    expect(dark.page['--primary']).toBe('#5c77f1');
    expect(hoverContrast(dark.primary, roundedTint(dark.primary, CANVAS))).toBeGreaterThanOrEqual(4.51);
    expect(onOwnTint(dark.primary, CANVAS)).toBeGreaterThanOrEqual(4.51);
  });

  it('keeps the hex #744 chose wherever it already had the margin: #494992 (its mix read 4.5083:1 on its tint)', () => {
    expect(onOwnTint(hoverMixOklab(hoverRgb('#494992'), [255, 255, 255], 0.72), CANVAS)).toBeCloseTo(4.5083, 4);
    const dark = legacyDark('#494992');
    expect([dark.page['--primary'], dark.page['--primary-foreground'], drawerRule(dark.css, 'dark')]).toEqual([
      '#797db4',
      '#171717',
      '--primary:#8387ba;--primary-foreground:#171717',
    ]);
    expect(replacementShortfalls('#494992')).toEqual([]);
  });

  it('meets every target for any brand, and keeps each mix wherever it reads with room to spare', () => {
    const clears = (ratio: number) => ratio >= 4.51;
    const levels = [0, 36, 73, 109, 146, 182, 219, 255];
    for (const r of levels)
      for (const g of levels)
        for (const b of levels) {
          const brand = toHex([r, g, b]);
          expect(shortfalls(brand), brand).toEqual([]);
          expect(replacementShortfalls(brand), brand).toEqual([]);
          const { page, css } = legacyDark(brand);
          const mixed = hoverMixOklab([r, g, b], [255, 255, 255], 0.72);
          if (clears(hoverContrast(mixed, hoverRgb(CANVAS))) && clears(onOwnTint(mixed, CANVAS)) && clears(hoverContrast(hoverRgb(POPOVER), mixed)))
            expect(page['--primary'], brand).toBe(`color-mix(in oklab,${brand} 72%,white)`);
          const code = hoverMixOklab([r, g, b], [255, 255, 255], 0.55);
          if (clears(hoverContrast(code, hoverRgb(CODE))))
            expect(css, brand).toContain(`--theme-code-accent:color-mix(in oklab,${brand} 55%,white);`);
        }
  });
});

// The reader's other primary buttons with a label: the header's call to action
// and the not-found page's search button. Their hover used to fade fill and label
// together (`hover:opacity-90`), which fell below AA with #b96a3d. The classes are
// read from the components, so these cases follow what ships.
describe('call-to-action hover in the header and on the not-found page', () => {
  interface PagePalette {
    name: string;
    header: string;
    page: string;
    foreground: string;
    accent: number[];
    onAccent: string;
  }
  const designSystem = (mode: 'light' | 'dark') => {
    const css = read('../../../../../packages/design-system/src/styles/globals.css');
    const block = css.slice(css.indexOf(mode === 'light' ? ':root {' : '.dark {'));
    const token = (name: string) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1] as string;
    return { canvas: token('background'), foreground: token('foreground') };
  };
  const palettes: PagePalette[] = [
    ...(['harbor', 'manuscript', 'signal'] as const).flatMap((preset) =>
      [undefined, '#b96a3d'].flatMap((brand) =>
        (['light', 'dark'] as const).map((mode) => {
          const config = { theme: { preset }, ...(brand ? { styling: { primaryColor: brand } } : {}) } as never;
          const variables = projectThemeVariables(config, mode) as Record<string, string>;
          const colors = resolveProjectTheme(config).colors[mode];
          return {
            name: `${preset}${brand ? ` + ${brand}` : ''} ${mode}`,
            // Signal's toolbar sits on the surface; the other headers on the canvas (styles.css).
            header: preset === 'signal' ? colors.surface : colors.canvas,
            page: colors.canvas,
            foreground: variables['--foreground'] as string,
            accent: hoverRgb(variables['--primary'] as string),
            onAccent: variables['--primary-foreground'] as string,
          };
        }),
      ),
    ),
    // Pre-v1 sites draw on the design system's canvas with the brand as accent.
    ...['#5546e8', '#b96a3d'].flatMap((brand) => {
      const css = projectThemeCss({ styling: { primaryColor: brand } } as never);
      const light = css.match(/:root,\.nibleaf-site-chrome\{[^}]*--primary:(#[0-9a-f]{6});--primary-foreground:(#[0-9a-f]{6})/);
      const dark = css.match(
        /:root\.dark,[^{]*\{[^}]*--primary:color-mix\(in oklab,(#[0-9a-f]{6}) (\d+)%,white\);--primary-foreground:(#[0-9a-f]{6})/,
      );
      const [lightDs, darkDs] = [designSystem('light'), designSystem('dark')];
      return [
        {
          name: `legacy ${brand} light`,
          header: lightDs.canvas,
          page: lightDs.canvas,
          foreground: lightDs.foreground,
          accent: hoverRgb(light?.[1] as string),
          onAccent: light?.[2] as string,
        },
        {
          name: `legacy ${brand} dark`,
          header: darkDs.canvas,
          page: darkDs.canvas,
          foreground: darkDs.foreground,
          accent: hoverMixOklab(hoverRgb(dark?.[1] as string), [255, 255, 255], Number(dark?.[2]) / 100),
          onAccent: dark?.[3] as string,
        },
      ];
    }),
  ];

  const routeSource = read('../../routes/sites/$projectId/route.tsx');
  const headerStart = routeSource.indexOf('data-analytics-placement="navbar"');
  const buttons = [
    {
      name: 'header',
      classes: routeSource.slice(headerStart).match(/className="([^"]*)"/)?.[1] ?? '',
      surface: (palette: PagePalette) => palette.header,
    },
    {
      name: 'not-found',
      classes: read('site-not-found.tsx').match(/className="([^"]*bg-primary [^"]*text-primary-foreground[^"]*)"/)?.[1] ?? '',
      surface: (palette: PagePalette) => palette.page,
    },
  ];

  it('reads both buttons, which no longer fade their label with their fill', () => {
    for (const button of buttons) {
      expect(button.classes, button.name).toContain('bg-primary');
      expect(button.classes, button.name).toContain('text-primary-foreground');
      expect(button.classes, button.name).not.toMatch(/hover:opacity-/);
      // Only the fill transitions: transition-colors would also fade the focus outline in.
      expect(button.classes, button.name).toContain('transition-[background-color]');
    }
  });

  it.each(buttons.flatMap((button) => palettes.map((palette) => ({ button, palette, label: `${button.name}: ${palette.name}` }))))(
    'keeps the label at AA on hover, with a visible change: $label',
    ({ button, palette }) => {
      // The label sits on the far side of the foreground (light on a dark accent,
      // dark on a light one), so a fill moved towards the foreground leaves it.
      expect(contrastRatio(palette.onAccent, palette.foreground)).toBeGreaterThanOrEqual(4.5);
      const label = hoverRgb(palette.onAccent);
      const surface = hoverRgb(button.surface(palette));
      const resting = hoverContrast(label, palette.accent);
      const opacity = button.classes.match(/hover:opacity-(\d+)/)?.[1];
      const mixed = button.classes.match(/hover:bg-\[color-mix\(in_oklab,var\(--primary\)_(\d+)%,var\(--foreground\)\)\]/)?.[1];
      let fill: number[];
      let hovered: number;
      if (opacity) {
        // The whole button fades over what it sits on: label and fill alike.
        const alpha = Number(opacity) / 100;
        fill = hoverOver(surface, palette.accent, alpha);
        hovered = hoverContrast(hoverOver(surface, label, alpha), fill);
      } else {
        expect(mixed).toBeDefined();
        fill = hoverMixOklab(palette.accent, hoverRgb(palette.foreground), Number(mixed) / 100);
        hovered = hoverContrast(label, fill);
      }
      expect(hovered).toBeGreaterThanOrEqual(4.5);
      expect(hovered).toBeGreaterThanOrEqual(resting);
      // A visible hover: the fill steps at least about 1.1:1 from its resting colour.
      expect(hoverContrast(fill, palette.accent)).toBeGreaterThan(1.1);
    },
  );
});

// #828 review: accent text on the page shares the accent shade picked at 4.5:1
// (#613), and inside a solid callout the #682 shade. Fading it on hover
// (`hover:opacity-80`) took Signal + #b96a3d's #c17951 from 5.01:1 to 3.68:1 on
// a warning callout. Article links and the breadcrumb trail keep their colour on
// hover and signal it with the underline instead. Read from the components, so
// these cases follow what ships.
describe('accent text keeps its colour on hover', () => {
  it('styles article links without an opacity hover', () => {
    const markdown = read('../markdown.tsx');
    const anchor = markdown.slice(markdown.indexOf('function anchorRenderer'));
    const classes = anchor.match(/className=\{cn\('([^']*text-primary[^']*)'/)?.[1] ?? '';
    expect(classes).toContain('text-primary');
    expect(classes).not.toMatch(/hover:opacity-/);
    expect(classes).toContain('hover:decoration-2');
  });

  it('styles the breadcrumb trail, which is accent text, without an opacity hover', () => {
    const view = read('site-page-view.tsx');
    const trail = view.slice(view.indexOf("aria-label={tReader('breadcrumb')}"));
    expect(trail).toMatch(/^aria-label=\{tReader\('breadcrumb'\)\}[\s\S]*?text-primary/);
    const link = trail.slice(trail.indexOf('<a'), trail.indexOf('</a>'));
    const classes = link.match(/className="([^"]*)"/)?.[1] ?? '';
    expect(link).toContain('crumb.path');
    expect(classes).not.toMatch(/hover:opacity-/);
    expect(classes).toContain('hover:underline');
  });
});

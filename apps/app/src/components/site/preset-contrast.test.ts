/**
 * Preset contrast on published sites (PUB-019). axe found two failures on
 * main's presets in light mode: Signal's solid callouts drew dark text on their
 * dark fill (1.05:1), and the code block's language label read 3.81:1 on
 * Manuscript's code chrome.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectThemeCss, projectThemeVariables, resolveProjectTheme } from '@/lib/site-theme';

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), 'utf8');

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

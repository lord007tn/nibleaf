/**
 * Preset contrast on published sites (PUB-019). axe found two failures on
 * main's presets in light mode: Signal's solid callouts drew dark text on their
 * dark fill (1.05:1), and the code block's language label read 3.81:1 on
 * Manuscript's code chrome.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectThemeCss } from '@/lib/site-theme';

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

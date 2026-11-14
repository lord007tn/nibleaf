/**
 * Preset contrast on published sites (PUB-019). axe found two failures on
 * main's presets in light mode: Signal's solid callouts drew dark text on their
 * dark fill (1.05:1), and the code block's language label read 3.81:1 on
 * Manuscript's code chrome.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), 'utf8');

describe('preset contrast (PUB-019)', () => {
  it('solid callouts move the foreground aliases to the code surface their fill is drawn on', () => {
    const css = read('../../styles.css');
    const start = css.indexOf('[data-theme-callouts="solid"]');
    const rule = css.slice(start, css.indexOf('}', start));
    // The callout's text-foreground utility outranks this layer, so the alias itself must move.
    expect(rule).toContain('--foreground: var(--theme-code-foreground)');
    expect(rule).toContain('--muted-foreground: var(--theme-code-muted)');
  });

  it("draws the code block's language label at a contrast that reads on the dark chrome", () => {
    expect(read('reader-code-block.tsx')).toContain('font-mono text-[10px] text-white/70 uppercase');
  });
});

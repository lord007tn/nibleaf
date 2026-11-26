import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 1.4.11 (non-text contrast): an unticked checkbox or unchosen radio is
// only its boundary, so that boundary needs 3:1 against every surface the
// control sits on, in light and in dark. Read from the real tokens and classes.
const css = readFileSync(new URL('../../../../../packages/design-system/src/styles/globals.css', import.meta.url), 'utf8');
const source = (name: string) => readFileSync(new URL(`../../../../../packages/design-system/src/components/ui/${name}`, import.meta.url), 'utf8');

const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No ${selector} block`);
  return css.slice(start, css.indexOf('}', start));
};
const token = (scope: string, name: string) => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block(scope));
  if (!match?.[1]) throw new Error(`No --${name} in ${scope}`);
  return match[1];
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.039_28 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('checkbox and radio boundaries', () => {
  it.each(['checkbox.tsx', 'radio-group.tsx'])('%s draws its unchecked border in the muted text colour, not --input', (file) => {
    const text = source(file);
    expect(text).toContain('border border-muted-foreground');
    expect(text).not.toContain('border border-input');
  });

  it.each([':root', '.dark'])('meets 3:1 against the page, cards and dialogs in %s', (scope) => {
    const boundary = token(scope, 'muted-foreground');
    for (const surface of ['background', 'card', 'popover']) {
      expect(contrast(boundary, token(scope, surface)), `${scope} ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each([':root', '.dark'])('keeps a ticked or chosen control at 3:1 in %s', (scope) => {
    for (const surface of ['background', 'card', 'popover']) {
      expect(contrast(token(scope, 'primary'), token(scope, surface)), `${scope} ${surface}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(token(scope, 'primary-foreground'), token(scope, 'primary'))).toBeGreaterThanOrEqual(3);
  });
});

// WCAG 1.4.11 again: an empty text field, select or OTP slot is only its
// boundary too, and so is a switch that is off in light mode (its thumb is the
// page colour). They draw it with --input-edge, which must reach 3:1 against
// every surface a form sits on (page, cards, dialogs and muted panels).
describe('text field boundaries', () => {
  it.each(['input.tsx', 'textarea.tsx', 'select.tsx', 'input-group.tsx', 'input-otp.tsx'])('%s draws its border with --input-edge', (file) => {
    expect(source(file)).toContain('border border-input-edge');
  });

  it('draws an unchecked switch track with --input-edge in light mode', () => {
    expect(source('switch.tsx')).toContain('data-unchecked:bg-input-edge');
  });

  it.each([':root', '.dark'])('meets 3:1 against the page, cards, dialogs and muted panels in %s', (scope) => {
    const boundary = token(scope, 'input-edge');
    for (const surface of ['background', 'card', 'popover', 'muted']) {
      expect(contrast(boundary, token(scope, surface)), `${scope} ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each([':root', '.dark'])('keeps the old quiet --input tone below 3:1 in %s, so fields must not draw their edge with it', (scope) => {
    // --input stays the fill tone (dark field fills, the command search box).
    expect(contrast(token(scope, 'input'), token(scope, 'card'))).toBeLessThan(3);
  });
});

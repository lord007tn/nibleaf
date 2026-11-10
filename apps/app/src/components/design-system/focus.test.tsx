// @vitest-environment jsdom
import { currentFocusTarget, restoreFocusFallback } from '@nibleaf/design-system/lib/focus';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => document.body.replaceChildren());

describe('focus helpers', () => {
  it('treats focus resting on the body as nothing to return to', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    expect(currentFocusTarget()).toBeNull();
  });

  it('returns the focused element', () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    expect(currentFocusTarget()).toBe(button);
  });

  it('falls back to the page h1 when the previous focus was the body', () => {
    const heading = document.createElement('h1');
    document.body.append(heading);
    expect(restoreFocusFallback(document.body)).toBe(heading);
    expect(heading.tabIndex).toBe(-1);
  });
});

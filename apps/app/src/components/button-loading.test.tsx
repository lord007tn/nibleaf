// @vitest-environment jsdom

import { Button } from '@nibleaf/design-system/components/ui/button';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

/**
 * Elements removed from the accessibility tree. jsdom doesn't load Tailwind, so
 * the utilities that set `visibility: hidden` / `display: none` are modelled by
 * class; `opacity-0` deliberately is not, because opacity keeps content exposed.
 */
const isHiddenFromAT = (el: Element) =>
  el.getAttribute('aria-hidden') === 'true' || el.classList.contains('invisible') || el.classList.contains('hidden');

/** The name a screen reader computes from a button's content (accname "name from content"). */
function accessibleName(el: Element): string {
  let name = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) name += node.textContent ?? '';
    else if (node instanceof Element && !isHiddenFromAT(node)) name += accessibleName(node);
  }
  return name.replace(/\s+/g, ' ').trim();
}

/** Mirrors Testing Library's `getByRole('button', { name })`, which isn't installed in this repo. */
function getButtonByName(container: HTMLElement, name: string) {
  const matches = [...container.querySelectorAll('button')].filter((button) => accessibleName(button) === name);
  if (matches.length !== 1) throw new Error(`Expected one button named "${name}", found ${matches.length}`);
  return matches[0] as HTMLButtonElement;
}

/** True when the element or an ancestor inside the button is hidden from assistive tech. */
const hiddenWithin = (el: Element | null | undefined, button: Element) => {
  for (let node = el; node && node !== button; node = node.parentElement) if (isHiddenFromAT(node)) return true;
  return false;
};

describe('Button loading accessibility', () => {
  it('keeps the label as the accessible name while loading without loadingText', async () => {
    const container = await render(<Button loading>Save</Button>);
    const button = getButtonByName(container, 'Save');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('data-loading')).toBe(true);
    const label = [...button.querySelectorAll('span')].filter((span) => span.textContent === 'Save').at(-1);
    expect(hiddenWithin(label, button)).toBe(false);
    // The spinner layer adds nothing to the name.
    expect(hiddenWithin(button.querySelector('svg'), button)).toBe(true);
  });

  it.each([
    { dir: 'ltr', idle: 'Save', busy: 'Saving…' },
    { dir: 'rtl', idle: 'حفظ', busy: 'جارٍ الحفظ…' },
  ] as const)('announces the loading text instead of the label in $dir', async ({ dir, idle, busy }) => {
    const container = await render(
      <div dir={dir}>
        <Button loading loadingText={busy}>
          {idle}
        </Button>
      </div>,
    );
    const button = getButtonByName(container, busy);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    const label = [...button.querySelectorAll('span')].filter((span) => span.textContent === idle).at(-1);
    expect(hiddenWithin(label, button)).toBe(true);
    expect(hiddenWithin(button.querySelector('svg'), button)).toBe(true);
  });

  it('names the button by its label and hides the spinner when not loading', async () => {
    const container = await render(
      <Button loading={false} loadingText="Saving…">
        Save
      </Button>,
    );
    const button = getButtonByName(container, 'Save');
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
    const spinner = button.querySelector('svg');
    expect(spinner).not.toBeNull();
    expect(hiddenWithin(spinner, button)).toBe(true);
    const loadingText = [...button.querySelectorAll('span')].find((span) => span.textContent === 'Saving…');
    expect(hiddenWithin(loadingText, button)).toBe(true);
  });

  it('renders the same DOM as a plain button when `loading` is not passed', () => {
    const markup = renderToStaticMarkup(<Button>Save</Button>);
    expect(markup).not.toContain('<span');
    expect(markup).not.toContain('aria-busy');
    expect(markup).not.toContain('data-loading');
    expect(markup).toMatch(/^<button [^>]*>Save<\/button>$/);
  });
});

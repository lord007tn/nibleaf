// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => `[${key}]` }));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', subscribeLanguage: () => () => undefined }));

import { InsightsFilterBar } from './filter-bar';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function renderBar(onChange = vi.fn()) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<InsightsFilterBar filters={{ range: '30d' }} onChange={onChange} timezone="UTC" />));
  return onChange;
}

/** Native date inputs ignore direct `.value =`; React reads the prototype setter. */
function setDate(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function openPicker() {
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('custom.label'));
  await act(async () => trigger?.click());
  const [from, to] = [...document.querySelectorAll<HTMLInputElement>('input[type="date"]')];
  const apply = [...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')][0];
  if (!from || !to || !apply) throw new Error('custom range picker did not open');
  return { from, to, apply };
}

describe('custom range picker', () => {
  it('ties the validation message to both dates and clears it once corrected', async () => {
    const onChange = await renderBar();
    const { from, to, apply } = await openPicker();

    await act(async () => {
      setDate(from, '2026-10-20');
      setDate(to, '2026-10-01');
    });
    // No message before the first Apply.
    expect(document.querySelector('[role="alert"]')).toBeNull();

    await act(async () => apply.click());
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('[analytics.filter.custom.errorOrder]');
    expect(from.getAttribute('aria-invalid')).toBe('true');
    expect(from.getAttribute('aria-describedby')).toBe(alert?.id);
    expect(to.getAttribute('aria-describedby')).toBe(alert?.id);
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => setDate(to, '2026-10-25'));
    expect(document.querySelector('[role="alert"]')).toBeNull();

    await act(async () => apply.click());
    expect(onChange).toHaveBeenLastCalledWith({ range: 'custom', from: '2026-10-20', to: '2026-10-25' });
  });
});

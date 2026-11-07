// @vitest-environment jsdom
import { translateFn } from '@nibleaf/i18n';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  return { useT: () => (key: Parameters<typeof translate>[0]) => translate(key, undefined, state.locale) };
});

import { FailureMessage } from './failure-message';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
describe('job failure details', () => {
  it.each(['en', 'ar'] as const)('keeps raw text collapsed with a localized next step in %s', async (locale) => {
    state.locale = locale;
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(() => root.render(<FailureMessage context="git" error="ProviderError: fetch failed at private.ts:18" />));
      expect(host.querySelector('p')?.textContent).toBe(translateFn('failures.connection', undefined, locale));
      expect(host.querySelector('p')?.textContent).not.toContain('ProviderError');
      expect(host.querySelector('details')?.open).toBe(false);
      expect(host.querySelector('summary')?.textContent).toBe(translateFn('failures.details', undefined, locale));
      expect(host.querySelector('pre')?.textContent).toContain('private.ts:18');
      expect(host.querySelector('details button')).toBeNull();
    } finally {
      await act(() => root.unmount());
    }
  });
});

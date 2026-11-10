/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Language } from '@/hooks/api';
import { LanguageSettingsDialog } from './language-settings-dialog';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/hooks/api', () => ({ friendlyErrorMessage: () => 'error', useUpdateLanguage: () => ({ isPending: false, mutate: vi.fn() }) }));

const arabic = {
  id: 'ar',
  code: 'ar',
  label: 'العربية',
  direction: 'RTL',
  isDefault: false,
  enabled: true,
  position: 1,
  config: null,
} as unknown as Language;

describe('language settings dialog', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('closes from its Cancel button, with no corner close button, and stacks its sections on narrow screens', async () => {
    const onOpenChange = vi.fn();
    await act(async () => root.render(<LanguageSettingsDialog language={arabic} onOpenChange={onOpenChange} open projectId="project-a" />));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) throw new Error('Dialog was not rendered');
    // The only close control is the footer's Cancel (the corner X is gone).
    const closers = [...dialog.querySelectorAll<HTMLElement>('[data-slot="dialog-close"]')];
    expect(closers.map((element) => element.textContent)).toEqual(['common.cancel']);
    // Below `sm` the section list sits above the form instead of a fixed 12rem column
    // beside it, so the footer (Cancel, Save) is never pushed outside a phone-width dialog.
    const aside = dialog.querySelector('aside');
    expect(aside?.className).toContain('w-full');
    expect(aside?.className).toContain('sm:w-48');
    expect(aside?.parentElement?.className).toContain('flex-col');
    expect(aside?.parentElement?.className).toContain('sm:flex-row');
    await act(async () => closers[0]?.click());
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});

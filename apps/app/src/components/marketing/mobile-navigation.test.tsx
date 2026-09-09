// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { MobileNavigation } from './mobile-navigation';

it.each(['en', 'ar'] as const)('opens localized navigation and closes it after selecting a destination (%s)', async (language) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MobileNavigation language={language} links={[{ href: '#pricing', label: 'Pricing' }]} />));
    const trigger = container.querySelector('button');
    expect(trigger?.getAttribute('aria-label')).toBe(language === 'ar' ? 'فتح القائمة' : 'Open menu');
    await act(async () => trigger?.click());
    expect(document.querySelector('[role="dialog"]')?.getAttribute('dir')).toBe(language === 'ar' ? 'rtl' : 'ltr');
    const link = document.querySelector<HTMLAnchorElement>('nav a[href="#pricing"]');
    expect(link).not.toBeNull();
    await act(async () => link?.click());
    expect(document.querySelector('[role="dialog"][data-open]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

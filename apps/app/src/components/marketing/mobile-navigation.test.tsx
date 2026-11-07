// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { shellAr } from './copy/shell.ar';
import { shellEn } from './copy/shell.en';
import { MobileNavigation } from './mobile-navigation';
import { MarketingSiteShell } from './site/marketing-site-shell';

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

it.each(['en', 'ar'] as const)('keeps the language link and theme action inside the localized menu (%s)', async (language) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const copy = language === 'ar' ? shellAr : shellEn;
  const alternate = language === 'ar' ? '/' : '/ar';
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <MarketingSiteShell lang={language} copy={copy} alternateHref={alternate}>
          <h1>Docs</h1>
        </MarketingSiteShell>,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${copy.menu.open}"]`);
    await act(async () => trigger?.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('lang')).toBe(language);
    expect(dialog?.querySelector(`a[href="${alternate}"][hreflang="${copy.languageSwitch.hrefLang}"]`)).not.toBeNull();
    expect(dialog?.querySelector(`button[aria-label="${copy.theme.toDark}"]`)).not.toBeNull();
    expect(dialog?.querySelector(`a[href="${copy.login.href}"]`)).not.toBeNull();
    const close = dialog?.querySelector<HTMLButtonElement>(`button[aria-label="${copy.menu.close}"]`);
    await act(async () => close?.click());
    expect(document.querySelector('[role="dialog"][data-open]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '@/hooks/api/types';
import { appendAnalyticsScript, PrivacyChoicesLink, SiteAnalyticsConsent } from './site-analytics-consent';

const consentConfig = {
  analytics: { ga4: 'G-TEST' },
  addons: {
    consentBanner: {
      enabled: true,
      placement: 'bottom-end',
      presentation: 'comfortable',
      buttonLayout: 'inline',
    },
  },
} satisfies ProjectConfig;

describe('appendAnalyticsScript', () => {
  afterEach(() => {
    document.head.replaceChildren();
  });

  it('copies the response CSP nonce onto consent-loaded scripts', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'csp-nonce');
    meta.content = 'response-nonce';
    document.head.appendChild(meta);

    appendAnalyticsScript('project', 0, { children: 'window.dataLayer=[];' });
    appendAnalyticsScript('project', 1, { src: 'https://www.googletagmanager.com/gtag/js?id=G-TEST', async: true });

    const scripts = [...document.head.querySelectorAll<HTMLScriptElement>('script')];
    expect(scripts).toHaveLength(2);
    expect(scripts.every((script) => script.nonce === 'response-nonce')).toBe(true);
  });
});

/** The banner and the reader footer's "Privacy choices", as the reader renders them. */
const withFooter = (props: Parameters<typeof SiteAnalyticsConsent>[0]) =>
  createElement(
    'div',
    null,
    createElement('main', null, createElement('a', { href: '#top' }, 'Top')),
    createElement('footer', null, createElement(PrivacyChoicesLink, { projectId: props.projectId, config: props.config, lang: props.lang })),
    createElement(SiteAnalyticsConsent, props),
  );

describe('SiteAnalyticsConsent', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    window.localStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.head.replaceChildren();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it.each([
    { lang: 'en', declineLabel: 'Decline', acceptLabel: 'Accept analytics', manageLabel: 'Privacy choices' },
    { lang: 'ar', declineLabel: 'رفض', acceptLabel: 'قبول التحليلات', manageLabel: 'خيارات الخصوصية' },
  ])('renders equal-weight $lang choices and keeps both actions available', async ({ lang, declineLabel, acceptLabel, manageLabel }) => {
    await act(async () => root.render(withFooter({ projectId: `project-${lang}`, config: consentConfig, lang })));

    const choices = [...container.querySelectorAll<HTMLButtonElement>('section button')];
    const decline = choices.find((button) => button.textContent === declineLabel);
    const accept = choices.find((button) => button.textContent === acceptLabel);
    expect(choices.map((button) => button.textContent)).toEqual([declineLabel, acceptLabel]);
    expect(decline?.className).toBe(accept?.className);

    await act(async () => decline?.click());
    expect(window.localStorage.getItem(`nibleaf.analytics.consent.project-${lang}`)).toBe('declined');

    // Nothing floats over the page after the choice; the footer reopens the banner.
    expect(container.querySelector('section')).toBeNull();
    expect(container.querySelectorAll('.fixed')).toHaveLength(0);
    const manage = [...container.querySelectorAll<HTMLButtonElement>('footer button')].find((button) => button.textContent === manageLabel);
    await act(async () => manage?.click());
    const acceptAfterReopen = [...container.querySelectorAll('button')].find((button) => button.textContent === acceptLabel);
    await act(async () => acceptAfterReopen?.click());
    expect(window.localStorage.getItem(`nibleaf.analytics.consent.project-${lang}`)).toBe('accepted');
  });

  it('moves focus into the reopened banner and back to "Privacy choices" after the new choice', async () => {
    window.localStorage.setItem('nibleaf.analytics.consent.focus', 'declined');
    await act(async () => root.render(withFooter({ projectId: 'focus', config: consentConfig, lang: 'en' })));
    const manage = container.querySelector<HTMLButtonElement>('footer button');
    manage?.focus();
    await act(async () => manage?.click());
    const banner = container.querySelector('section');
    expect(document.activeElement).toBe(banner);
    const decline = [...container.querySelectorAll('section button')].find((button) => button.textContent === 'Decline') as HTMLButtonElement;
    await act(async () => decline.click());
    expect(container.querySelector('section')).toBeNull();
    expect(document.activeElement).toBe(manage);
  });

  it('gives the footer control a 44px target on touch screens', () => {
    const html = renderToString(createElement(PrivacyChoicesLink, { projectId: 'x', config: consentConfig, lang: 'en' }));
    expect(html).toContain('pointer-coarse:min-h-11');
    expect(html).toContain('min-h-6');
  });

  it('shows no footer control on sites that do not ask for consent', () => {
    const html = renderToString(createElement(PrivacyChoicesLink, { projectId: 'none', config: {}, lang: 'en' }));
    expect(html).toBe('');
    expect(renderToString(createElement(PrivacyChoicesLink, { projectId: 'x', config: consentConfig, lang: 'ar' }))).toContain('خيارات الخصوصية');
  });

  it.each(['en', 'ar'])('renders the configured policy as an accessible %s link', async (lang) => {
    const config = {
      ...consentConfig,
      addons: { consentBanner: { ...consentConfig.addons.consentBanner, privacyPolicyUrl: 'https://example.invalid/privacy' } },
    };
    await act(async () => root.render(createElement(SiteAnalyticsConsent, { projectId: 'policy', config, lang })));
    const link = container.querySelector('a');
    expect(link?.href).toBe('https://example.invalid/privacy');
    expect(link?.textContent?.trim()).toBeTruthy();
    expect(link?.className).toContain('min-h-11');
  });

  it('lets readers choose native analytics consent without any third-party scripts', async () => {
    await act(async () =>
      root.render(createElement(SiteAnalyticsConsent, { projectId: 'native', config: { analytics: { cookieConsent: true } }, lang: 'en' })),
    );
    expect(container.querySelector('section')).not.toBeNull();
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('reloads after an accepted visitor reopens privacy choices and withdraws consent', async () => {
    const reloadPage = vi.fn();
    window.localStorage.setItem('nibleaf.analytics.consent.project-withdraw', 'accepted');

    await act(async () => root.render(withFooter({ projectId: 'project-withdraw', config: consentConfig, lang: 'en', reloadPage })));
    expect(document.head.querySelectorAll('script')).toHaveLength(2);

    const manage = [...container.querySelectorAll<HTMLButtonElement>('footer button')].find((button) => button.textContent === 'Privacy choices');
    await act(async () => manage?.click());
    const decline = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Decline');
    await act(async () => decline?.click());

    expect(window.localStorage.getItem('nibleaf.analytics.consent.project-withdraw')).toBe('declined');
    expect(reloadPage).toHaveBeenCalledOnce();
  });

  it('keeps analytics consent optional and the reader usable when storage getters throw', async () => {
    for (const storage of ['localStorage', 'sessionStorage'] as const) {
      vi.spyOn(window, storage, 'get').mockImplementation(() => {
        throw new DOMException('Storage access denied', 'SecurityError');
      });
    }
    await act(async () => root.render(withFooter({ projectId: 'private-reader', config: consentConfig, lang: 'en' })));

    expect(document.head.querySelectorAll('script')).toHaveLength(0);
    const decline = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Decline');
    await act(async () => decline?.click());
    expect(container.textContent).toContain('Privacy choices');
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });
});

it.each(['accepted', 'declined'])('does not render the pending banner on the hydration snapshot for stored %s', (choice) => {
  window.localStorage.setItem('nibleaf.analytics.consent.hydration', choice);
  const html = renderToString(createElement(SiteAnalyticsConsent, { projectId: 'hydration', config: consentConfig, lang: 'en' }));
  expect(html).not.toContain('<section');
  expect(html).not.toContain('Accept analytics');
});

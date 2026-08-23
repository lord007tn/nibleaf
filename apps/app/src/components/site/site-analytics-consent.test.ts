// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectConfig } from '@/hooks/api/types';
import { appendAnalyticsScript, SiteAnalyticsConsent } from './site-analytics-consent';

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
    window.localStorage.clear();
  });

  it.each([
    { lang: 'en', declineLabel: 'Decline', acceptLabel: 'Accept analytics', manageLabel: 'Privacy choices' },
    { lang: 'ar', declineLabel: 'رفض', acceptLabel: 'قبول التحليلات', manageLabel: 'خيارات الخصوصية' },
  ])('renders equal-weight $lang choices and keeps both actions available', async ({ lang, declineLabel, acceptLabel, manageLabel }) => {
    await act(async () => root.render(createElement(SiteAnalyticsConsent, { projectId: `project-${lang}`, config: consentConfig, lang })));

    const choices = [...container.querySelectorAll('button')];
    const decline = choices.find((button) => button.textContent === declineLabel);
    const accept = choices.find((button) => button.textContent === acceptLabel);
    expect(choices.map((button) => button.textContent)).toEqual([declineLabel, acceptLabel]);
    expect(decline?.className).toBe(accept?.className);

    await act(async () => decline?.click());
    expect(window.localStorage.getItem(`nibleaf.analytics.consent.project-${lang}`)).toBe('declined');

    const manage = [...container.querySelectorAll('button')].find((button) => button.textContent === manageLabel);
    await act(async () => manage?.click());
    const acceptAfterReopen = [...container.querySelectorAll('button')].find((button) => button.textContent === acceptLabel);
    await act(async () => acceptAfterReopen?.click());
    expect(window.localStorage.getItem(`nibleaf.analytics.consent.project-${lang}`)).toBe('accepted');
  });
});

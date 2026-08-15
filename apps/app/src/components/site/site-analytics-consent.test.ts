// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { appendAnalyticsScript } from './site-analytics-consent';

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

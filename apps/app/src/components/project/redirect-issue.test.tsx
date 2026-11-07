import { translateFn } from '@nibleaf/i18n';
import type { RedirectIssueCode } from '@nibleaf/shared/redirects';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  return { useT: () => (key: Parameters<typeof translate>[0]) => translate(key, undefined, state.locale) };
});

import { RedirectIssue } from './redirect-issue';

describe('publish redirect explanations', () => {
  it.each(['en', 'ar'] as const)('explains every redirect issue in %s without developer messages', (locale) => {
    state.locale = locale;
    const codes: RedirectIssueCode[] = [
      'malformed-source',
      'malformed-destination',
      'duplicate-source',
      'self-redirect',
      'cycle',
      'chain-too-long',
      'too-many-rules',
      'source-collision',
      'destination-not-found',
      'invalid-locale',
      'route-collision',
    ];
    for (const code of codes) {
      const html = renderToStaticMarkup(
        <RedirectIssue issue={{ code, message: 'RAW route collision at internal.ts:1', sequence: ['/old', '/new'], rowIndexes: [0] }} />,
      );
      expect(html).not.toContain('RAW');
      expect(html).not.toContain('publish.redirectIssue.');
      expect(html).toContain('/old');
      expect(html).toContain('dir="ltr"');
      expect(html).toMatch(locale === 'ar' ? /[\u0600-\u06ff]/ : /[a-z]/);
    }
    expect(translateFn('publish.editRedirects', undefined, locale)).not.toBe('publish.editRedirects');
  });
});

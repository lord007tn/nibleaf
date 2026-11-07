import { translateFn } from '@nibleaf/i18n';
import { describe, expect, it } from 'vitest';
import type { NotificationItem } from '@/hooks/api/types';
import { failureMessageKey } from '../failure-message';
import { notificationText } from './notification-text';

const item = (overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'notification-1',
  projectId: 'project-1',
  type: 'deploy_ready',
  title: 'Stored title',
  body: 'Stored body',
  href: null,
  readAt: null,
  createdAt: '2026-11-07T00:00:00Z',
  ...overrides,
});

describe('localized notification payloads', () => {
  it.each(['en', 'ar'] as const)('renders structured events in %s and isolates names', (locale) => {
    const t = (key: Parameters<typeof translateFn>[0], variables?: Parameters<typeof translateFn>[1]) => translateFn(key, variables, locale);
    const text = notificationText(t, item({ params: { projectName: 'Fixture', version: 3 } }), locale);
    expect(text.title).toContain('\u2068Fixture\u2069');
    expect(text.title).not.toContain('Stored title');
    expect(text.body).toContain('\u20683\u2069');
    expect(text.title).toMatch(locale === 'ar' ? /نشر/ : /published/);
    for (const type of ['export_ready', 'import_completed', 'feedback']) {
      const translated = notificationText(t, item({ type, params: { imported: 1, updated: 2 } }), locale);
      expect(translated.title).not.toContain('Stored title');
    }
    for (const type of ['deploy_failed', 'export_failed']) {
      const translated = notificationText(t, item({ type, params: { details: 'ProviderError: fetch failed at internal.ts:123' } }), locale);
      expect(translated.title + translated.body).not.toMatch(/ProviderError|internal.ts/);
      expect(translated.details).toContain('ProviderError');
      expect(translated.body).toMatch(locale === 'ar' ? /حاول/ : /Try/);
    }
  });

  it.each(['en', 'ar'] as const)('preserves imported and updated counts and isolates the source in %s', (locale) => {
    const t = (key: Parameters<typeof translateFn>[0], variables?: Parameters<typeof translateFn>[1]) => translateFn(key, variables, locale);
    const text = notificationText(t, item({ type: 'import_completed', params: { imported: 3, updated: 1, source: 'GitBook دليل' } }), locale);
    expect(text.body).toBe(
      locale === 'en'
        ? '3 pages imported and 1 page updated from \u2068GitBook دليل\u2069.'
        : 'استُوردت 3 صفحات، وحُدّثت صفحة واحدة من \u2068GitBook دليل\u2069.',
    );
    const git = notificationText(t, item({ type: 'import_completed', params: { imported: 1, updated: 2, source: 'git' } }), locale);
    expect(git.body).toContain(locale === 'en' ? 'the connected Git repository' : 'مستودع Git المتصل');
  });

  it.each([
    [0, 'لم تُستورد أي صفحات', 'لم تُحدّث أي صفحات'],
    [1, 'استُوردت صفحة واحدة', 'حُدّثت صفحة واحدة'],
    [2, 'استُوردت صفحتان', 'حُدّثت صفحتان'],
    [3, 'استُوردت 3 صفحات', 'حُدّثت 3 صفحات'],
    [11, 'استُوردت 11 صفحة', 'حُدّثت 11 صفحة'],
    [100, 'استُوردت 100 صفحة', 'حُدّثت 100 صفحة'],
  ] as const)('selects Arabic plural forms for %s imported and updated pages', (count, imported, updated) => {
    const t = (key: Parameters<typeof translateFn>[0], variables?: Parameters<typeof translateFn>[1]) => translateFn(key, variables, 'ar');
    const text = notificationText(t, item({ type: 'import_completed', params: { imported: count, updated: count, source: 'Fixture' } }), 'ar');
    expect(text.body).toBe(`${imported}، و${updated} من \u2068Fixture\u2069.`);
  });

  it.each(['en', 'ar'] as const)('preserves the feedback page and sentiment in %s', (locale) => {
    const t = (key: Parameters<typeof translateFn>[0], variables?: Parameters<typeof translateFn>[1]) => translateFn(key, variables, locale);
    const positive = notificationText(t, item({ type: 'feedback', params: { path: '/guide/دليل', sentiment: 'helpful' } }), locale);
    const negative = notificationText(t, item({ type: 'feedback', params: { path: '/guide/دليل', sentiment: 'not helpful' } }), locale);
    const generic = notificationText(t, item({ type: 'feedback', params: { path: '/guide/دليل', sentiment: null } }), locale);
    for (const text of [positive, negative, generic]) expect(text.body).toContain('\u2068/guide/دليل\u2069');
    expect(positive.body).toContain(locale === 'en' ? 'as helpful' : 'مفيدة');
    expect(negative.body).toContain(locale === 'en' ? 'as not helpful' : 'غير مفيدة');
    expect(positive.body).not.toBe(negative.body);
    expect(generic.body).toContain(locale === 'en' ? 'left feedback' : 'ملاحظاته');
  });

  it('preserves old rows, unknown types and malformed parameters', () => {
    const t = (key: Parameters<typeof translateFn>[0]) => key;
    for (const params of [undefined, null, [], 'bad', { projectName: 4 }]) {
      expect(notificationText(t, item({ params }))).toEqual({ title: 'Stored title', body: 'Stored body' });
    }
    expect(notificationText(t, item({ type: 'future_event', params: {} })).title).toBe('Stored title');
    expect(notificationText(t, item({ type: 'export_failed', body: 'raw provider failure' }))).toEqual({
      title: 'notifications.exportFailed.title',
      body: 'failures.export',
      details: 'raw provider failure',
    });
    expect(notificationText(t, item({ type: 'deploy_failed', params: null, title: 'Fixture publish failed', body: 'raw provider failure' }))).toEqual(
      {
        title: 'Fixture publish failed',
        body: 'failures.publish',
        details: 'raw provider failure',
      },
    );
  });

  it.each([
    ['No published revision is available.', 'export', 'failures.unpublished'],
    ['Export assets exceed the 100-byte limit.', 'export', 'failures.tooLarge'],
    ['Redirect cycle detected', 'publish', 'failures.redirects'],
    ['Git non-fast-forward', 'git', 'failures.conflict'],
    ['Bad credentials', 'git', 'failures.access'],
    ['connect ECONNREFUSED', 'publish', 'failures.connection'],
    ['Chromium executable missing', 'export', 'failures.unavailable'],
    ['unknown provider error', 'export', 'failures.export'],
  ] as const)('classifies %s without returning provider text', (error, context, key) => {
    expect(failureMessageKey(error, context)).toBe(key);
  });
});

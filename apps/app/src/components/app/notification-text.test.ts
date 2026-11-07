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
    const text = notificationText(t, item({ params: { projectName: 'Fixture', version: 3 } }));
    expect(text.title).toContain('\u2068Fixture\u2069');
    expect(text.title).not.toContain('Stored title');
    expect(text.body).toContain('\u20683\u2069');
    expect(text.title).toMatch(locale === 'ar' ? /نشر/ : /published/);
    for (const type of ['export_ready', 'import_completed', 'feedback']) {
      const translated = notificationText(t, item({ type, params: { imported: 1, updated: 2 } }));
      expect(translated.title).not.toContain('Stored title');
    }
    for (const type of ['deploy_failed', 'export_failed']) {
      const translated = notificationText(t, item({ type, params: { details: 'ProviderError: fetch failed at internal.ts:123' } }));
      expect(translated.title + translated.body).not.toMatch(/ProviderError|internal.ts/);
      expect(translated.details).toContain('ProviderError');
      expect(translated.body).toMatch(locale === 'ar' ? /حاول/ : /Try/);
    }
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

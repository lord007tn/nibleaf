import type { SiteSnapshot } from '@nibleaf/shared/site';
import { describe, expect, it } from 'vitest';
import { sanitizePublishedSiteActionUrls } from './published-action-urls';

describe('stored published action links', () => {
  it('neutralizes unsafe links in project and language config without mutating the snapshot', () => {
    const config = {
      addons: { editUrl: 'java\tscript:alert(1)', issueUrl: 'data:text/html,test', feedback: true },
      search: { aiSupportUrl: '\u0001javascript:alert(1)', aiAnswers: true },
      branding: { logo: 'unchanged' },
    };
    const snapshot = { project: { config, languages: [{ code: 'ar', config }] }, pages: [] } as unknown as SiteSnapshot;
    const result = sanitizePublishedSiteActionUrls(snapshot);
    const expected = { addons: { feedback: true }, search: { aiAnswers: true }, branding: { logo: 'unchanged' } };
    expect(result.project.config).toEqual(expected);
    expect(result.project.languages[0]?.config).toEqual(expected);
    expect(config.addons.editUrl).toBe('java\tscript:alert(1)');
    expect(result.pages).toBe(snapshot.pages);
  });

  it('preserves valid template and support links', () => {
    const config = {
      addons: { editUrl: 'https://example.com/{path}', issueUrl: 'http://example.com/?url={url}' },
      search: { aiSupportUrl: 'mailto:help@example.com' },
    };
    const snapshot = { project: { config, languages: [{ code: 'en', config: null }] } } as unknown as SiteSnapshot;
    expect(sanitizePublishedSiteActionUrls(snapshot)).toEqual(snapshot);
  });
});

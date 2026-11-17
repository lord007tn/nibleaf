import { describe, expect, it } from 'vitest';
import { isLocatablePublishCheck, LOCATABLE_PUBLISH_CHECK_CODES, PUBLISH_CHECK_CODES, publishFixSearch } from './publish-check-codes';

describe('publish check Fix target', () => {
  it('sends the exact evidence for a problem the editor can find on the page', () => {
    expect(publishFixSearch('broken-internal-link', 'p1', { detail: '/configuration' })).toEqual({
      page: 'p1',
      fix: 'broken-internal-link',
      fixTarget: '/configuration',
    });
    expect(publishFixSearch('missing-alt', 'p1', { detail: '/diagram.png' })).toMatchObject({ fixTarget: '/diagram.png' });
  });

  it('names only the problem for page-level checks, where the page itself is the evidence', () => {
    for (const code of ['untitled-page', 'empty-page', 'unreadable-slug', 'duplicate-title', 'home-untranslated', 'blog-root-group'] as const) {
      expect(isLocatablePublishCheck(code)).toBe(false);
      expect(publishFixSearch(code, 'p1', { detail: 'other/page' })).toEqual({ page: 'p1', fix: code });
    }
  });

  it('leaves out evidence the server shortened, since it would not match the source', () => {
    expect(publishFixSearch('broken-internal-link', 'p1', { detail: '/very-long…', truncated: true })).toEqual({
      page: 'p1',
      fix: 'broken-internal-link',
    });
  });

  it('lists every locatable code among the check codes', () => {
    for (const code of LOCATABLE_PUBLISH_CHECK_CODES) expect(PUBLISH_CHECK_CODES).toContain(code);
  });
});

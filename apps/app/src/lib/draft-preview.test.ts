import { describe, expect, it } from 'vitest';
import { draftPreviewHref } from './draft-preview';

describe('draftPreviewHref', () => {
  it('opens the exact unpublished branch, language, and page', () => {
    expect(
      draftPreviewHref('project 1', {
        branchId: 'draft/beta',
        languageId: 'ar language',
        pageId: 'page?intro',
      }),
    ).toBe('/app/projects/project%201/preview?branchId=draft%2Fbeta&languageId=ar+language&pageId=page%3Fintro');
  });

  it('does not add an empty query string', () => {
    expect(draftPreviewHref('project-id')).toBe('/app/projects/project-id/preview');
  });
});

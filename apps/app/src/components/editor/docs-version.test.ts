import { describe, expect, it } from 'vitest';
import { deepLinkBranchDecision, publishedVersionSlugFor } from './docs-version';

const branch = (id: string, name: string, isDefault: boolean, createdAt: string) => ({ id, name, isDefault, createdAt });

describe('publishedVersionSlugFor', () => {
  const branches = [branch('b-v2', 'Version 2.0', false, '2026-02-01T00:00:00.000Z'), branch('b-main', 'main', true, '2026-01-01T00:00:00.000Z')];

  it('gives no prefix for the default version', () => {
    expect(publishedVersionSlugFor(branches, 'b-main')).toBeUndefined();
  });

  it('uses the published slug for a non-default version', () => {
    expect(publishedVersionSlugFor(branches, 'b-v2')).toBe('version-2.0');
  });

  it('resolves name clashes in publish order (default first, then oldest first)', () => {
    const clashing = [
      branch('b-new', 'Beta', false, '2026-03-01T00:00:00.000Z'),
      branch('b-old', 'beta', false, '2026-02-01T00:00:00.000Z'),
      branch('b-main', 'beta', true, '2026-01-01T00:00:00.000Z'),
    ];
    expect(publishedVersionSlugFor(clashing, 'b-main')).toBeUndefined();
    expect(publishedVersionSlugFor(clashing, 'b-old')).toBe('beta-b-old');
    expect(publishedVersionSlugFor(clashing, 'b-new')).toBe('beta-b-new');
  });

  it('gives no prefix when the version is unknown or not loaded', () => {
    expect(publishedVersionSlugFor(undefined, 'b-v2')).toBeUndefined();
    expect(publishedVersionSlugFor(branches, undefined)).toBeUndefined();
    expect(publishedVersionSlugFor(branches, 'missing')).toBeUndefined();
  });
});

describe('deepLinkBranchDecision', () => {
  const branches = [{ id: 'main' }, { id: 'v2' }];

  it('does nothing without a deep link', () => {
    expect(deepLinkBranchDecision({ deepLinkedPageId: null, page: { id: 'p', branchId: 'v2' }, activeBranchId: 'main', branches })).toEqual({
      kind: 'done',
    });
  });

  it('waits until the deep-linked page itself has loaded', () => {
    expect(deepLinkBranchDecision({ deepLinkedPageId: 'p', page: undefined, activeBranchId: 'main', branches })).toEqual({ kind: 'wait' });
    // A page left over from the previous version must not decide anything.
    expect(deepLinkBranchDecision({ deepLinkedPageId: 'p', page: { id: 'old', branchId: 'v2' }, activeBranchId: 'main', branches })).toEqual({
      kind: 'wait',
    });
  });

  it('switches to the page version when it differs from the one on screen', () => {
    expect(deepLinkBranchDecision({ deepLinkedPageId: 'p', page: { id: 'p', branchId: 'v2' }, activeBranchId: 'main', branches })).toEqual({
      kind: 'switch',
      branchId: 'v2',
    });
    // Before the default version was even picked.
    expect(deepLinkBranchDecision({ deepLinkedPageId: 'p', page: { id: 'p', branchId: 'v2' }, activeBranchId: null, branches })).toEqual({
      kind: 'switch',
      branchId: 'v2',
    });
  });

  it('is done when the page is already in the version on screen', () => {
    expect(deepLinkBranchDecision({ deepLinkedPageId: 'p', page: { id: 'p', branchId: 'main' }, activeBranchId: 'main', branches })).toEqual({
      kind: 'done',
    });
  });

  it('waits for the version list, and ignores versions it does not know', () => {
    expect(deepLinkBranchDecision({ deepLinkedPageId: 'p', page: { id: 'p', branchId: 'v2' }, activeBranchId: 'main', branches: undefined })).toEqual(
      {
        kind: 'wait',
      },
    );
    expect(deepLinkBranchDecision({ deepLinkedPageId: 'p', page: { id: 'p', branchId: 'gone' }, activeBranchId: 'main', branches })).toEqual({
      kind: 'done',
    });
    expect(deepLinkBranchDecision({ deepLinkedPageId: 'p', page: { id: 'p' }, activeBranchId: 'main', branches })).toEqual({ kind: 'done' });
  });
});

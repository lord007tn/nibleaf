import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PageNode } from '@/hooks/api';
import { countDescendants, isSwitchSettled, messageInLanguage, pageStructureRevision, subtreeIds, titleSlugToFollow } from './page-tree-utils';

const tree = [
  { id: 'group', parentId: null },
  { id: 'a', parentId: 'group' },
  { id: 'a1', parentId: 'a' },
  { id: 'b', parentId: 'group' },
  { id: 'other', parentId: null },
];

describe('subtree helpers', () => {
  it('counts every page below a node, not just direct children', () => {
    expect(countDescendants(tree, 'group')).toBe(3);
    expect(countDescendants(tree, 'a')).toBe(1);
    expect(countDescendants(tree, 'other')).toBe(0);
  });

  it('includes the node itself in its subtree', () => {
    expect([...subtreeIds(tree, 'a')].sort()).toEqual(['a', 'a1']);
  });

  it('survives a parent cycle in bad data', () => {
    expect(countDescendants([...tree, { id: 'group', parentId: 'a1' }], 'group')).toBe(3);
  });
});

describe('titleSlugToFollow', () => {
  const base = { unpublished: true };

  it('replaces the placeholder address with the first real title', () => {
    expect(titleSlugToFollow({ ...base, slug: 'untitled', serverTitle: 'Untitled', nextTitle: 'Getting started' })).toBe('Getting started');
    expect(titleSlugToFollow({ ...base, slug: 'untitled-3', serverTitle: 'Untitled', nextTitle: 'Billing' })).toBe('Billing');
  });

  it('keeps following later title edits while the address still matches the title', () => {
    // An accidental first title must not be baked into the URL forever.
    expect(
      titleSlugToFollow({
        ...base,
        slug: 'untitledgetting-started',
        serverTitle: 'UntitledGetting started',
        nextTitle: 'Getting started',
      }),
    ).toBe('Getting started');
    expect(titleSlugToFollow({ ...base, slug: 'faq-2', serverTitle: 'FAQ', nextTitle: 'FAQs' })).toBe('FAQs');
  });

  it('follows Arabic titles with Unicode addresses', () => {
    expect(titleSlugToFollow({ ...base, slug: 'كيفية-الدفع', serverTitle: 'كيفية الدفع', nextTitle: 'كيفية تغيير كلمة المرور' })).toBe(
      'كيفية تغيير كلمة المرور',
    );
  });

  it('stops once the writer set their own address', () => {
    expect(titleSlugToFollow({ ...base, slug: 'reset', serverTitle: 'Reset your password', nextTitle: 'Reset a password' })).toBeUndefined();
  });

  it('never changes the address of a published page', () => {
    expect(titleSlugToFollow({ unpublished: false, slug: 'untitled', serverTitle: 'Untitled', nextTitle: 'Billing' })).toBeUndefined();
  });

  it('ignores unchanged and empty titles', () => {
    expect(titleSlugToFollow({ ...base, slug: 'faq', serverTitle: 'FAQ', nextTitle: 'FAQ' })).toBeUndefined();
    expect(titleSlugToFollow({ ...base, slug: 'faq', serverTitle: 'FAQ', nextTitle: '   ' })).toBeUndefined();
    expect(titleSlugToFollow({ ...base, slug: 'faq', serverTitle: 'FAQ', nextTitle: '🎉' })).toBeUndefined();
  });
});

describe('isSwitchSettled (B1: no typing into the page being left)', () => {
  const shown = { selectedId: 'old', groupId: null, pageId: 'old' };

  it('stays locked while a page is being created', () => {
    expect(isSwitchSettled({ kind: 'create' }, shown)).toBe(false);
  });

  it('stays locked until the target page is the one on screen', () => {
    const pending = { kind: 'open', id: 'new' } as const;
    // Selected, but the old page's content is still what the canvas holds.
    expect(isSwitchSettled(pending, { selectedId: 'new', groupId: null, pageId: 'old' })).toBe(false);
    expect(isSwitchSettled(pending, { selectedId: 'new', groupId: null, pageId: null })).toBe(false);
    expect(isSwitchSettled(pending, { selectedId: 'new', groupId: null, pageId: 'new' })).toBe(true);
  });

  it('settles for a group as soon as it is selected', () => {
    expect(isSwitchSettled({ kind: 'open', id: 'g' }, { selectedId: 'g', groupId: 'g', pageId: null })).toBe(true);
  });

  it('is settled when nothing is pending', () => {
    expect(isSwitchSettled(null, shown)).toBe(true);
  });
});

describe('messageInLanguage', () => {
  it("uses the page's language, not the interface language", () => {
    expect(messageInLanguage('editor.untitled', 'ar', () => 'Untitled')).toBe('صفحة بدون عنوان');
    expect(messageInLanguage('editor.untitled', 'ar-SA', () => 'Untitled')).toBe('صفحة بدون عنوان');
    expect(messageInLanguage('editor.untitled', 'en', () => 'x')).toBe('Untitled');
  });

  it('falls back to the interface language for other page languages', () => {
    expect(messageInLanguage('editor.untitled', 'ja', () => 'fallback')).toBe('fallback');
    expect(messageInLanguage('editor.untitled', undefined, () => 'fallback')).toBe('fallback');
  });
});

describe('pageStructureRevision (Move to… precondition)', () => {
  const rows = [
    { id: 'cmh2b0x9k0002', parentId: null, branchId: 'main', languageId: 'en', position: 1 },
    { id: 'cmh2b0x9k0001', parentId: 'cmh2b0x9k0002', branchId: 'main', languageId: 'en', position: 0 },
    { id: 'cmh2b0xak0003', parentId: null, branchId: 'main', languageId: 'ar', position: 0 },
  ] as PageNode[];

  it('is the hash the server reports for the same rows, in the published protocol', async () => {
    // The protocol as documented in the PostgreSQL suite: SHA-256 of the ID-sorted structural tuples.
    const expected = createHash('sha256')
      .update(
        JSON.stringify(
          [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((page) => [page.id, page.parentId, page.branchId, page.languageId, page.position]),
        ),
      )
      .digest('hex');
    expect(await pageStructureRevision(rows)).toBe(expected);
  });

  it('changes when the structure changes, not with row order', async () => {
    const revision = await pageStructureRevision(rows);
    expect(await pageStructureRevision([...rows].reverse())).toBe(revision);
    expect(await pageStructureRevision(rows.map((page) => (page.id === 'cmh2b0xak0003' ? { ...page, position: 1 } : page)))).not.toBe(revision);
  });

  it('is left out when a row has no branch to hash', async () => {
    expect(await pageStructureRevision([{ ...rows[0], branchId: undefined } as PageNode])).toBeUndefined();
  });
});

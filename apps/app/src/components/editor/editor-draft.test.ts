import { describe, expect, it } from 'vitest';
import { type DraftState, isDirty, nextHydration, type ServerSnapshot, shouldAutosave, snapshotOf } from './editor-draft';

const pageA: ServerSnapshot = { id: 'a', title: 'Getting started', content: '# Hello\n\n- one\n- two', updatedAt: '2026-09-01T10:00:00.000Z' };
const pageB: ServerSnapshot = { id: 'b', title: 'Authentication', content: 'Use a bearer token.', updatedAt: '2026-09-01T11:00:00.000Z' };
const newPage: ServerSnapshot = { id: 'new', title: 'Untitled', content: '', updatedAt: '2026-09-01T12:00:00.000Z' };
const arabicPage: ServerSnapshot = { id: 'ar', title: 'المصادقة', content: 'استخدم رمز الحامل.', updatedAt: '2026-09-01T12:30:00.000Z' };

const cleanState = (page: ServerSnapshot): DraftState => ({ synced: snapshotOf(page), draft: { title: page.title, content: page.content } });

describe('nextHydration', () => {
  it('loads the first page when nothing is synced yet', () => {
    expect(nextHydration({ synced: null, draft: { title: '', content: '' } }, pageA)).toEqual(snapshotOf(pageA));
  });

  it('does nothing while the page detail is still loading', () => {
    expect(nextHydration(cleanState(pageA), undefined)).toBeNull();
    expect(nextHydration(cleanState(pageA), null)).toBeNull();
  });

  it('switching to a NEW EMPTY page loads its empty body, never the previous page', () => {
    const hydration = nextHydration(cleanState(pageA), newPage);
    expect(hydration).toEqual(snapshotOf(newPage));
    expect(hydration?.content).toBe('');
  });

  it('switching to a new empty page discards unsaved edits of the previous page from the draft', () => {
    // The previous page's pending save still fires with its own captured args;
    // the draft itself must belong to the new page.
    const state: DraftState = { synced: snapshotOf(pageA), draft: { title: pageA.title, content: `${pageA.content}\n\nmore` } };
    expect(nextHydration(state, newPage)).toEqual(snapshotOf(newPage));
  });

  it('switches between two non-empty pages', () => {
    expect(nextHydration(cleanState(pageA), pageB)).toEqual(snapshotOf(pageB));
    expect(nextHydration(cleanState(pageB), pageA)).toEqual(snapshotOf(pageA));
  });

  it('switches across languages (RTL page)', () => {
    expect(nextHydration(cleanState(pageA), arabicPage)).toEqual(snapshotOf(arabicPage));
    expect(nextHydration(cleanState(arabicPage), newPage)).toEqual(snapshotOf(newPage));
  });

  it('leaves a clean, unchanged page alone', () => {
    expect(nextHydration(cleanState(pageA), pageA)).toBeNull();
    // A refetch that yields identical content (new object, same stamp) is a no-op too.
    expect(nextHydration(cleanState(pageA), { ...pageA })).toBeNull();
  });

  it('re-hydrates from a newer server copy while the draft is clean', () => {
    const refreshed: ServerSnapshot = { ...pageA, content: '# Hello (edited elsewhere)', updatedAt: '2026-09-01T10:05:00.000Z' };
    expect(nextHydration(cleanState(pageA), refreshed)).toEqual(snapshotOf(refreshed));
  });

  it('adopts a server-side title change while clean', () => {
    const renamed: ServerSnapshot = { ...pageA, title: 'Quickstart', updatedAt: '2026-09-01T10:05:00.000Z' };
    expect(nextHydration(cleanState(pageA), renamed)).toEqual(snapshotOf(renamed));
  });

  it('preserves unsaved edits when the server copy changes', () => {
    const state: DraftState = { synced: snapshotOf(pageA), draft: { title: pageA.title, content: `${pageA.content}\n\ntyping…` } };
    const refreshed: ServerSnapshot = { ...pageA, content: '# Hello (edited elsewhere)', updatedAt: '2026-09-01T10:05:00.000Z' };
    expect(nextHydration(state, refreshed)).toBeNull();
  });

  it('ignores a stale detail query right after a save (older revision)', () => {
    // After a save the synced snapshot carries the response's newer stamp while
    // the detail query still holds the pre-save copy until it refetches.
    const saved: DraftState = {
      synced: { id: 'a', title: pageA.title, content: 'saved body', updatedAt: '2026-09-01T10:10:00.000Z' },
      draft: { title: pageA.title, content: 'saved body' },
    };
    expect(nextHydration(saved, pageA)).toBeNull();
  });

  it('falls back to content comparison when a revision stamp is missing or invalid', () => {
    const noStamp: DraftState = { synced: { id: 'a', title: pageA.title, content: 'old' }, draft: { title: pageA.title, content: 'old' } };
    expect(nextHydration(noStamp, pageA)).toEqual(snapshotOf(pageA));
    const badStamp: DraftState = {
      synced: { id: 'a', title: pageA.title, content: 'old', updatedAt: 'not-a-date' },
      draft: { title: pageA.title, content: 'old' },
    };
    expect(nextHydration(badStamp, pageA)).toEqual(snapshotOf(pageA));
  });
});

describe('shouldAutosave', () => {
  it('never saves before the page has been loaded and matched', () => {
    expect(shouldAutosave({ synced: null, draft: { title: 'x', content: 'y' } }, pageA)).toBe(false);
    expect(shouldAutosave(cleanState(pageA), undefined)).toBe(false);
  });

  it('never saves a draft to a page it was not hydrated from (the new-page leak)', () => {
    // Draft still holds page A's body while the new page is the active one.
    const state: DraftState = { synced: snapshotOf(pageA), draft: { title: pageA.title, content: pageA.content } };
    expect(shouldAutosave(state, newPage)).toBe(false);
    const dirty: DraftState = { synced: snapshotOf(pageA), draft: { title: 'Untitled', content: pageA.content } };
    expect(shouldAutosave(dirty, newPage)).toBe(false);
  });

  it('does not save a clean draft', () => {
    expect(shouldAutosave(cleanState(pageA), pageA)).toBe(false);
    expect(shouldAutosave(cleanState(newPage), newPage)).toBe(false);
  });

  it('saves edits to the hydrated page', () => {
    expect(shouldAutosave({ synced: snapshotOf(pageA), draft: { title: pageA.title, content: 'edited' } }, pageA)).toBe(true);
    expect(shouldAutosave({ synced: snapshotOf(pageA), draft: { title: 'Renamed', content: pageA.content } }, pageA)).toBe(true);
    expect(shouldAutosave({ synced: snapshotOf(newPage), draft: { title: newPage.title, content: 'first words' } }, newPage)).toBe(true);
  });

  it('never automatically replaces a non-empty page with an empty body', () => {
    expect(shouldAutosave({ synced: snapshotOf(pageA), draft: { title: pageA.title, content: '' } }, pageA)).toBe(false);
    expect(shouldAutosave({ synced: snapshotOf(pageA), draft: { title: pageA.title, content: '  \n' } }, pageA)).toBe(false);
    // A title-only edit that arrives together with a transiently empty body is held back too.
    expect(shouldAutosave({ synced: snapshotOf(pageA), draft: { title: 'Renamed', content: '' } }, pageA)).toBe(false);
  });

  it('still saves a title edit on an empty page', () => {
    expect(shouldAutosave({ synced: snapshotOf(newPage), draft: { title: 'الصفحة الأولى', content: '' } }, newPage)).toBe(true);
  });
});

describe('isDirty', () => {
  it('is clean before hydration and when the draft matches', () => {
    expect(isDirty({ synced: null, draft: { title: 'a', content: 'b' } })).toBe(false);
    expect(isDirty(cleanState(pageA))).toBe(false);
  });

  it('is dirty on a title or content change', () => {
    expect(isDirty({ synced: snapshotOf(pageA), draft: { title: 'x', content: pageA.content } })).toBe(true);
    expect(isDirty({ synced: snapshotOf(pageA), draft: { title: pageA.title, content: 'x' } })).toBe(true);
  });
});

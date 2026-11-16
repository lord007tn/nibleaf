import { describe, expect, it } from 'vitest';
import {
  aiAssistState,
  createUnsavedDrafts,
  type DraftState,
  draftUnsavable,
  foreignCopyWhileDirty,
  isDirty,
  isEditorRevisionConflict,
  nextHydration,
  normalizedSaveConflict,
  restoreUnsavedDraft,
  type ServerSnapshot,
  shouldAutosave,
  shouldFlushDraft,
  shouldSaveDraft,
  snapshotOf,
} from './editor-draft';

const pageA: ServerSnapshot = { id: 'a', title: 'Getting started', content: '# Hello\n\n- one\n- two', updatedAt: '2026-09-01T10:00:00.000Z' };
const pageB: ServerSnapshot = { id: 'b', title: 'Authentication', content: 'Use a bearer token.', updatedAt: '2026-09-01T11:00:00.000Z' };
const newPage: ServerSnapshot = { id: 'new', title: 'Untitled', content: '', updatedAt: '2026-09-01T12:00:00.000Z' };
const arabicPage: ServerSnapshot = { id: 'ar', title: 'المصادقة', content: 'استخدم رمز الحامل.', updatedAt: '2026-09-01T12:30:00.000Z' };

const cleanState = (page: ServerSnapshot): DraftState => ({ synced: snapshotOf(page), draft: { title: page.title, content: page.content } });

describe('nextHydration', () => {
  it('loads the first page when nothing is synced yet', () => {
    expect(nextHydration({ synced: null, draft: { title: '', content: '' } }, pageA)).toEqual(snapshotOf(pageA));
  });

  it('never loads back a copy an own stored write was based on, whatever its stamp (#757)', () => {
    const saved = { ...pageA, content: 'Saved from the other copy.', updatedAt: '2026-09-01T09:00:00.000Z' };
    const older = { ...pageA, content: 'The copy the write was based on.', updatedAt: '2026-09-01T12:00:00.000Z' };
    const basedOn = (revision: string) => revision === older.updatedAt;
    expect(nextHydration(cleanState(saved), older, basedOn)).toBeNull();
    expect(nextHydration(cleanState(saved), older)).toEqual(snapshotOf(older));
    expect(nextHydration(cleanState(saved), { ...older, updatedAt: '2026-09-01T13:00:00.000Z' }, basedOn)).not.toBeNull();
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

  it('persists deliberate clearing after the correct page has hydrated', () => {
    expect(shouldAutosave({ synced: snapshotOf(pageA), draft: { title: pageA.title, content: '' } }, pageA)).toBe(true);
    expect(shouldAutosave({ synced: snapshotOf(pageA), draft: { title: pageA.title, content: '  \n' } }, pageA)).toBe(true);
    expect(shouldAutosave({ synced: snapshotOf(pageA), draft: { title: 'Renamed', content: '' } }, pageA)).toBe(true);
  });

  it('still saves a title edit on an empty page', () => {
    expect(shouldAutosave({ synced: snapshotOf(newPage), draft: { title: 'الصفحة الأولى', content: '' } }, newPage)).toBe(true);
  });
});

describe('shouldFlushDraft', () => {
  it('flushes an undo back to the original content while an older save is in flight', () => {
    const undone = cleanState(pageA);
    expect(shouldAutosave(undone, pageA)).toBe(false);
    expect(shouldFlushDraft(undone, pageA, true)).toBe(true);
    expect(shouldFlushDraft(undone, pageA, false)).toBe(false);
  });

  it('allows retrying a failed save but never writes a draft to another page', () => {
    expect(shouldFlushDraft(cleanState(pageA), pageA, false, true)).toBe(true);
    expect(shouldFlushDraft(cleanState(pageA), pageB, true, true)).toBe(false);
    expect(shouldFlushDraft({ synced: null, draft: { title: '', content: '' } }, newPage, true, true)).toBe(false);
  });
});

describe('shouldSaveDraft (#728)', () => {
  const inFlight = {
    ...snapshotOf(pageA),
    content: `${pageA.content}
- three`,
  };

  it('saves a draft back at the stored text while a write of other text is pending', () => {
    expect(shouldSaveDraft(cleanState(pageA), pageA, inFlight)).toBe(true);
    expect(shouldSaveDraft(cleanState(pageA), pageA, undefined)).toBe(false);
  });

  it('saves nothing more when the draft is what the pending write stores', () => {
    const typed: DraftState = { synced: snapshotOf(pageA), draft: { title: inFlight.title, content: inFlight.content } };
    expect(shouldAutosave(typed, pageA)).toBe(true);
    expect(shouldSaveDraft(typed, pageA, inFlight)).toBe(true);
    expect(shouldSaveDraft({ ...typed, synced: { ...inFlight } }, pageA, inFlight)).toBe(false);
  });

  it('ignores a pending write of another page, and never saves a conflicted draft', () => {
    expect(shouldSaveDraft(cleanState(pageA), pageA, { ...pageB })).toBe(false);
    expect(shouldSaveDraft({ ...cleanState(pageA), conflicted: true }, pageA, inFlight)).toBe(false);
    expect(shouldSaveDraft(cleanState(pageA), pageB, inFlight)).toBe(false);
  });
});

describe('normalizedSaveConflict (#757)', () => {
  it('is reviewed as a revision conflict, naming the page', () => {
    const conflict = normalizedSaveConflict('a');
    expect(isEditorRevisionConflict(conflict)).toBe(true);
    expect(conflict.details).toEqual({ id: 'a', reason: 'normalized' });
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

describe('draftUnsavable', () => {
  const dirty: DraftState = {
    synced: snapshotOf(pageA),
    draft: {
      title: pageA.title,
      content: `${pageA.content}

more`,
    },
  };

  it('asks before leaving only when a Viewer still has unsaved changes', () => {
    expect(draftUnsavable(true, dirty, pageA)).toBe(true);
    expect(draftUnsavable(false, dirty, pageA)).toBe(false);
    expect(draftUnsavable(true, cleanState(pageA), pageA)).toBe(false);
  });
});

describe('foreignCopyWhileDirty (#790)', () => {
  const theirs: ServerSnapshot = { ...pageA, content: 'Their newer copy.', updatedAt: '2026-09-01T10:05:00.000Z' };
  const edited: DraftState = { ...cleanState(pageA), draft: { title: pageA.title, content: 'My unsent change.' } };

  it("is a conflict: another client's newer copy over unsent changes", () => {
    expect(foreignCopyWhileDirty(edited, theirs)).toBe(true);
  });

  it('is not one over a clean draft (it is loaded), or once already in conflict', () => {
    expect(foreignCopyWhileDirty(cleanState(pageA), theirs)).toBe(false);
    expect(foreignCopyWhileDirty({ ...edited, conflicted: true }, theirs)).toBe(false);
  });

  it("is not one for the editor's own text: the draft's, the mirrored copy's, or a pending write's", () => {
    expect(foreignCopyWhileDirty(edited, { ...theirs, content: 'My unsent change.' })).toBe(false);
    expect(foreignCopyWhileDirty(edited, { ...theirs, content: pageA.content })).toBe(false);
    expect(foreignCopyWhileDirty(edited, theirs, undefined, { carries: (text) => text.content === 'Their newer copy.' })).toBe(false);
    expect(foreignCopyWhileDirty(edited, theirs, undefined, { carries: (text) => text.content === 'My unsent change.' })).toBe(false);
    // A write still at the server may have stored the copy (normalized): told apart once it settles.
    expect(foreignCopyWhileDirty(edited, theirs, undefined, { mayBeOwn: () => true })).toBe(false);
    expect(foreignCopyWhileDirty(edited, theirs, undefined, { carries: () => false, mayBeOwn: () => false })).toBe(true);
  });

  it('is not one for an older, superseded, unstamped or other page copy', () => {
    expect(foreignCopyWhileDirty(edited, { ...theirs, updatedAt: '2026-09-01T09:00:00.000Z' })).toBe(false);
    expect(foreignCopyWhileDirty(edited, theirs, (revision) => revision === theirs.updatedAt)).toBe(false);
    expect(foreignCopyWhileDirty(edited, { ...theirs, updatedAt: undefined })).toBe(false);
    expect(foreignCopyWhileDirty(edited, { ...pageB })).toBe(false);
  });
});

describe('aiAssistState', () => {
  it('council: a conflicted draft never hydrates from a refreshed server copy or autosaves', () => {
    const state = { synced: snapshotOf(pageA), draft: { title: pageA.title, content: pageA.content }, conflicted: true };
    const remote = { ...pageA, content: '[link](/new)', updatedAt: '2099-01-01T00:00:00Z' };
    expect(nextHydration(state, remote)).toBeNull();
    expect(shouldAutosave({ ...state, draft: { ...state.draft, content: 'keep my text' } }, remote)).toBe(false);
  });
  const settled = { isPending: false, isError: false };

  it('hides AI assist for Viewers and sites with no way to draft', () => {
    expect(aiAssistState(true, { ...settled, data: { reason: null } })).toBe('hidden');
    expect(aiAssistState(false, { ...settled, data: { reason: 'not_configured' } })).toBe('hidden');
    expect(aiAssistState(false, { ...settled, data: { reason: 'quota' } })).toBe('shown');
  });

  it('keeps a placeholder while loading', () => {
    expect(aiAssistState(false, { isPending: true, isError: false })).toBe('loading');
  });

  it('treats a 403 from the capability request as unavailable, other failures as unknown', () => {
    expect(aiAssistState(false, { isPending: false, isError: true, error: { status: 403 } })).toBe('hidden');
    expect(aiAssistState(false, { isPending: false, isError: true, error: { status: 503 } })).toBe('shown');
    expect(aiAssistState(false, { isPending: false, isError: true, error: new TypeError('Failed to fetch') })).toBe('shown');
  });
});

describe('unsaved drafts kept after the editor unmounted (#789)', () => {
  const kept = { id: pageA.id, title: pageA.title, content: 'My final draft.', base: pageA.updatedAt, error: new Error('Network error') };

  it("keeps a page's draft for its account only, until it is taken, and tells subscribers", () => {
    const drafts = createUnsavedDrafts();
    let calls = 0;
    const stop = drafts.subscribe(() => {
      calls += 1;
    });
    const ticket = drafts.issue('user-1', pageA.id);
    if (!ticket) throw new Error('No ticket');
    expect(drafts.pending('user-1', pageA.id)).toBe(true);
    drafts.failed(ticket, kept);
    expect(drafts.pending('user-1', pageA.id)).toBe(false);
    expect(drafts.peek('user-1', pageA.id)).toMatchObject(kept);
    expect(drafts.peek('user-2', pageA.id)).toBeUndefined();
    expect(drafts.peek('user-1', pageB.id)).toBeUndefined();
    expect(drafts.take('user-2', pageA.id)).toBeUndefined();
    expect(drafts.take('user-1', pageA.id)).toMatchObject(kept);
    expect(drafts.take('user-1', pageA.id)).toBeUndefined();
    stop();
    expect(calls).toBe(2);
    expect(drafts.issue(null, pageA.id)).toBeNull();
  });

  it('keeps the latest write only: an older failure never replaces a later one, nor survives a later stored write', () => {
    const drafts = createUnsavedDrafts();
    const older = drafts.issue('user-1', pageA.id);
    const newer = drafts.issue('user-1', pageA.id);
    if (!older || !newer) throw new Error('No ticket');
    drafts.failed(newer, { ...kept, content: 'Newer.' });
    drafts.failed(older, { ...kept, content: 'Older.' });
    expect(drafts.peek('user-1', pageA.id)?.content).toBe('Newer.');
    const later = drafts.issue('user-1', pageA.id);
    if (!later) throw new Error('No ticket');
    drafts.stored(later);
    expect(drafts.peek('user-1', pageA.id)).toBeUndefined();
    // A write queued before that stored one, failing after it, is out of date too.
    const stale = drafts.issue('user-1', pageB.id);
    const saved = drafts.issue('user-1', pageB.id);
    if (!stale || !saved) throw new Error('No ticket');
    drafts.stored(saved);
    drafts.failed(stale, { ...kept, id: pageB.id });
    expect(drafts.peek('user-1', pageB.id)).toBeUndefined();
  });

  it('keeps nothing for a text whose failure its editor already showed; a changed text is kept again', () => {
    const drafts = createUnsavedDrafts();
    const shown = drafts.issue('user-1', pageA.id);
    const retried = drafts.issue('user-1', pageA.id);
    const edited = drafts.issue('user-1', pageA.id);
    if (!shown || !retried || !edited) throw new Error('No ticket');
    drafts.settled(shown, kept);
    drafts.failed(retried, kept);
    expect(drafts.peek('user-1', pageA.id)).toBeUndefined();
    drafts.failed(edited, { ...kept, content: 'Edited since.' });
    expect(drafts.peek('user-1', pageA.id)?.content).toBe('Edited since.');
  });

  it('drops everything when the session ends, and ignores writes queued before', () => {
    const drafts = createUnsavedDrafts();
    const kept1 = drafts.issue('user-1', pageA.id);
    const late = drafts.issue('user-1', pageB.id);
    if (!kept1 || !late) throw new Error('No ticket');
    drafts.failed(kept1, kept);
    drafts.clear();
    expect(drafts.peek('user-1', pageA.id)).toBeUndefined();
    drafts.failed(late, { ...kept, id: pageB.id });
    expect(drafts.peek('user-1', pageB.id)).toBeUndefined();
    expect(drafts.pending('user-1', pageB.id)).toBe(false);
  });

  it('comes back as the draft over the revision it was meant for', () => {
    expect(restoreUnsavedDraft(kept, snapshotOf(pageA))).toBe('draft');
  });

  it('comes back as a conflict when its save raised one, or the server moved on since', () => {
    expect(restoreUnsavedDraft({ ...kept, error: normalizedSaveConflict(pageA.id) }, snapshotOf(pageA))).toBe('conflict');
    expect(restoreUnsavedDraft(kept, { ...snapshotOf(pageA), content: 'Another client.', updatedAt: '2026-09-01T10:05:00.000Z' })).toBe('conflict');
  });

  it('does not come back when the server holds it already, or on another page', () => {
    expect(restoreUnsavedDraft(kept, { ...snapshotOf(pageA), content: kept.content, updatedAt: '2026-09-01T10:05:00.000Z' })).toBeNull();
    expect(restoreUnsavedDraft(kept, snapshotOf(pageB))).toBeNull();
  });
});

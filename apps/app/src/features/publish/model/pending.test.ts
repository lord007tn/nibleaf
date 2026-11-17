import { describe, expect, it } from 'vitest';
import { hasUnpublishedChanges, pageLiveStatus, pendingState } from './pending';

const live = { hasBaseline: true, lastVersion: 3, upToDate: true, changes: [] };

describe('pendingState', () => {
  it('says nothing until the check answers', () => {
    expect(pendingState(undefined)).toEqual({ kind: 'unknown' });
  });

  it('leaves a never-published site to the first-publish flow', () => {
    expect(pendingState({ ...live, hasBaseline: false, lastVersion: null, changes: [{ id: 'a', status: 'added' }] })).toEqual({
      kind: 'neverPublished',
    });
  });

  it('counts changed pages against the live version', () => {
    const state = pendingState({
      ...live,
      upToDate: false,
      changes: [
        { id: 'a', status: 'modified' },
        { id: 'b', status: 'added' },
      ],
    });
    expect(state).toEqual({ kind: 'changes', count: 2, liveVersion: 3 });
    expect(hasUnpublishedChanges(state)).toBe(true);
  });

  it('still reports a site that is behind when only navigation or settings changed', () => {
    const state = pendingState({ ...live, upToDate: false });
    expect(state).toEqual({ kind: 'siteOnly', liveVersion: 3 });
    expect(hasUnpublishedChanges(state)).toBe(true);
  });

  it('reports an up-to-date site', () => {
    const state = pendingState(live);
    expect(state).toEqual({ kind: 'upToDate', liveVersion: 3 });
    expect(hasUnpublishedChanges(state)).toBe(false);
  });
});

describe('pageLiveStatus', () => {
  const pending = {
    ...live,
    upToDate: false,
    changes: [
      { id: 'new', status: 'added' },
      { id: 'edited', status: 'modified' },
    ],
  };
  it.each([
    ['new', 'draft'],
    ['edited', 'changed'],
    ['untouched', 'live'],
  ])('%s → %s', (pageId, status) => {
    expect(pageLiveStatus(pageId, pending)).toBe(status);
  });

  it('calls every page a draft before the first publish, and is silent while unknown', () => {
    expect(pageLiveStatus('untouched', { ...pending, hasBaseline: false })).toBe('draft');
    expect(pageLiveStatus('untouched', undefined)).toBeUndefined();
  });
});

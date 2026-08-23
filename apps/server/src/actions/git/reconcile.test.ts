import { describe, expect, it } from 'vitest';
import { conflictSnapshotMatches, reconcileFile, reconcileOwnedFile, repositoryOurs } from './reconcile';

describe('three-way Git reconciliation', () => {
  it.each([
    ['unchanged', 'base', 'base', 'base', false, 'base'],
    ['ours only', 'base', 'ours', 'base', false, 'ours'],
    ['theirs only', 'base', 'base', 'theirs', false, 'theirs'],
    ['same edit', 'base', 'same', 'same', false, 'same'],
    ['add in Nibleaf', null, 'new', null, false, 'new'],
    ['delete upstream', 'base', 'base', null, false, null],
  ])('%s', (_label, base, ours, theirs, conflict, content) => {
    expect(reconcileFile(base, ours, theirs)).toMatchObject({ conflict, content });
  });

  it('never chooses a side when both changed differently', () => {
    expect(reconcileFile('base', 'ours', 'theirs')).toEqual({ conflict: true, content: null, source: 'conflict' });
  });

  it('treats competing add/delete as a conflict', () => {
    expect(reconcileFile(null, 'ours', 'theirs').conflict).toBe(true);
    expect(reconcileFile('base', null, 'theirs').conflict).toBe(true);
  });

  it('invalidates an explicit resolution if any reconciliation input changes', () => {
    const snapshot = { baseContent: 'base', oursContent: 'ours', theirsContent: 'theirs' };
    expect(conflictSnapshotMatches(snapshot, { base: 'base', ours: 'ours', theirs: 'theirs' })).toBe(true);
    expect(conflictSnapshotMatches(snapshot, { base: 'base', ours: 'ours', theirs: 'new upstream' })).toBe(false);
    expect(conflictSnapshotMatches(snapshot, { base: 'base', ours: null, theirs: 'theirs' })).toBe(false);
  });

  it('preserves customer code after the initial scaffold', () => {
    expect(reconcileOwnedFile('CUSTOMER', null, 'starter', null)).toMatchObject({ conflict: false, content: 'starter', source: 'ours' });
    expect(reconcileOwnedFile('CUSTOMER', 'starter', 'new generated starter', 'customer edit')).toMatchObject({
      conflict: false,
      content: 'customer edit',
      source: 'theirs',
    });
    expect(reconcileOwnedFile('CUSTOMER', 'starter', 'new generated starter', null).content).toBeNull();
  });

  it('remembers customer deletion instead of reseeding a newer scaffold', () => {
    expect(repositoryOurs('CUSTOMER', { baseContent: null, baseExists: false }, 'new generated starter')).toBeNull();
    expect(repositoryOurs('CUSTOMER', undefined, 'initial starter')).toBe('initial starter');
    expect(repositoryOurs('PLATFORM', { baseContent: 'old snapshot', baseExists: true }, 'new snapshot')).toBe('new snapshot');
  });

  it('fails closed when a generated platform file is edited in Git', () => {
    expect(reconcileOwnedFile('PLATFORM', 'snapshot-v1', 'snapshot-v1', 'tampered')).toEqual({
      conflict: true,
      content: null,
      source: 'conflict',
    });
    expect(reconcileOwnedFile('PLATFORM', 'snapshot-v1', 'snapshot-v2', 'snapshot-v1')).toMatchObject({ conflict: false, content: 'snapshot-v2' });
  });
});

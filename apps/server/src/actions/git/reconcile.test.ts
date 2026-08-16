import { describe, expect, it } from 'vitest';
import { conflictSnapshotMatches, reconcileFile } from './reconcile';

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
});

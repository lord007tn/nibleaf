import { describe, expect, it } from 'vitest';
import { deepEqual, editedKeys, isDraftDirty, reconcileSaveSuccess, reconcileServerChange, resolveConflict } from './server-draft';

type Values = { name: string; slug: string; tags: string[]; meta: { title: string } };
const base: Values = { name: 'Docs', slug: 'docs', tags: ['a'], meta: { title: 'T' } };

describe('deepEqual', () => {
  it('compares plain values structurally', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe('dirty (rule 1)', () => {
  it('is any difference from the baseline, and nothing else', () => {
    expect(isDraftDirty(base, { ...base, tags: ['a'] })).toBe(false);
    expect(isDraftDirty({ ...base, meta: { title: 'U' } }, base)).toBe(true);
    expect(editedKeys({ ...base, name: 'Help', tags: ['a', 'b'] }, base)).toEqual(['name', 'tags']);
  });
});

describe('a server change while editing (rule 2)', () => {
  it('takes the server value for fields the person has not edited', () => {
    const change = reconcileServerChange({ baseline: base, current: base, next: { ...base, slug: 'help' } });
    expect(change.current.slug).toBe('help');
    expect(change.baseline.slug).toBe('help');
    expect(change.conflicts).toEqual([]);
  });

  it('keeps the person’s edit where the server left the field alone', () => {
    const current = { ...base, name: 'Mine' };
    const change = reconcileServerChange({ baseline: base, current, next: { ...base, slug: 'help' } });
    expect(change.current).toEqual({ ...base, name: 'Mine', slug: 'help' });
    expect(change.conflicts).toEqual([]);
  });

  it('keeps the edit and reports a conflict when both changed the same field differently', () => {
    const change = reconcileServerChange({ baseline: base, current: { ...base, name: 'Mine' }, next: { ...base, name: 'Theirs' } });
    expect(change.current.name).toBe('Mine');
    expect(change.baseline.name).toBe('Theirs');
    expect(change.conflicts).toEqual(['name']);
  });

  it('is not a conflict when both landed on the same value (e.g. our own save echoed back)', () => {
    const change = reconcileServerChange({ baseline: base, current: { ...base, name: 'Same' }, next: { ...base, name: 'Same' } });
    expect(change.conflicts).toEqual([]);
    expect(isDraftDirty(change.current, change.baseline)).toBe(false);
  });

  it('ignores a refetch that changed nothing editable', () => {
    const current = { ...base, name: 'Mine' };
    const change = reconcileServerChange({ baseline: base, current, next: { ...base } });
    expect(change.current).toEqual(current);
    expect(change.conflicts).toEqual([]);
  });
});

describe('a server change during a save (rule 2 with the submitted values)', () => {
  const submitted = { ...base, name: 'Sent' };

  it('keeps a value typed back to the baseline when the save’s own echo arrives', () => {
    const change = reconcileServerChange({ baseline: base, current: base, next: submitted, submitted });
    expect(change.current.name).toBe('Docs');
    expect(change.baseline.name).toBe('Sent');
    expect(change.conflicts).toEqual([]);
  });

  it('keeps a newer value and does not report the echo as a conflict', () => {
    const change = reconcileServerChange({ baseline: base, current: { ...base, name: 'Newer' }, next: submitted, submitted });
    expect(change.current.name).toBe('Newer');
    expect(change.conflicts).toEqual([]);
  });

  it('keeps the sent value when the refetch predates the save', () => {
    const change = reconcileServerChange({ baseline: base, current: submitted, next: { ...base, slug: 'help' }, submitted });
    expect(change.current).toEqual({ ...submitted, slug: 'help' });
    expect(change.conflicts).toEqual([]);
  });

  it('still takes and reports someone else’s changes', () => {
    const change = reconcileServerChange({ baseline: base, current: submitted, next: { ...base, name: 'Theirs', slug: 'help' }, submitted });
    expect(change.current).toEqual({ ...submitted, slug: 'help' });
    expect(change.conflicts).toEqual(['name']);
  });
});

describe('a successful save (rule 3)', () => {
  it('confirms what was sent', () => {
    const submitted = { ...base, name: 'Help' };
    const result = reconcileSaveSuccess({ submitted, current: submitted });
    expect(result.baseline).toEqual(submitted);
    expect(isDraftDirty(result.current, result.baseline)).toBe(false);
  });

  it('prefers the server’s normalized values', () => {
    const submitted = { ...base, name: ' Help ' };
    const result = reconcileSaveSuccess({ submitted, current: submitted, confirmed: { ...base, name: 'Help' } });
    expect(result.current.name).toBe('Help');
    expect(isDraftDirty(result.current, result.baseline)).toBe(false);
  });

  it('keeps edits typed while the save was in flight, and stays dirty for them', () => {
    const submitted = { ...base, name: 'A' };
    const result = reconcileSaveSuccess({ submitted, current: { ...base, name: 'AB' } });
    expect(result.baseline.name).toBe('A');
    expect(result.current.name).toBe('AB');
    expect(isDraftDirty(result.current, result.baseline)).toBe(true);
  });
});

describe('resolving a conflict', () => {
  it('takes the server value for "theirs" and keeps the edit for "mine"', () => {
    const current = { ...base, name: 'Mine' };
    const baseline = { ...base, name: 'Theirs' };
    expect(resolveConflict({ baseline, current, key: 'name', choice: 'theirs' }).name).toBe('Theirs');
    expect(resolveConflict({ baseline, current, key: 'name', choice: 'mine' }).name).toBe('Mine');
  });
});

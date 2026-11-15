import { describe, expect, it } from 'vitest';
import { deepEqual, editedKeys, isDraftDirty, reconcileSaveSuccess, reconcileServerChange, resolveConflict, startSave } from './server-draft';

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

describe('a server change during a save (rule 2 with the save’s state)', () => {
  const sent = { ...base, name: 'Sent' };
  const save = startSave(base, sent);

  it('records the keys the save changed, once', () => {
    expect([...save.sent]).toEqual(['name']);
    expect([...save.echoed]).toEqual([]);
  });

  it('keeps a value typed back to the baseline when the save’s own echo arrives', () => {
    const change = reconcileServerChange({ baseline: base, current: base, next: sent, save });
    expect(change.current.name).toBe('Docs');
    expect(change.baseline.name).toBe('Sent');
    expect(change.conflicts).toEqual([]);
    expect([...(change.save?.echoed ?? [])]).toEqual(['name']);
  });

  it('keeps a newer value and does not report the echo as a conflict', () => {
    const change = reconcileServerChange({ baseline: base, current: { ...base, name: 'Newer' }, next: sent, save });
    expect(change.current.name).toBe('Newer');
    expect(change.conflicts).toEqual([]);
  });

  it('keeps the sent value when the refetch predates the save', () => {
    const change = reconcileServerChange({ baseline: base, current: sent, next: { ...base, slug: 'help' }, save });
    expect(change.current).toEqual({ ...sent, slug: 'help' });
    expect(change.conflicts).toEqual([]);
    expect([...(change.save?.echoed ?? [])]).toEqual([]);
  });

  it('still takes and reports someone else’s changes', () => {
    const change = reconcileServerChange({ baseline: base, current: sent, next: { ...base, name: 'Theirs', slug: 'help' }, save });
    expect(change.current).toEqual({ ...sent, slug: 'help' });
    expect(change.conflicts).toEqual(['name']);
  });

  it('judges unsent keys against the moving baseline', () => {
    // A first refetch moved the slug; the save never touched it.
    const change = reconcileServerChange({
      baseline: { ...base, slug: 'two' },
      current: { ...sent, slug: 'two' },
      next: { ...sent, slug: 'three' },
      save,
    });
    expect(change.current).toEqual({ ...sent, slug: 'three' });
    expect(change.conflicts).toEqual([]);
  });

  it('keeps a key echoed for the rest of the save, so each later change is taken', () => {
    const echo = reconcileServerChange({ baseline: base, current: sent, next: sent, save });
    const theirs = reconcileServerChange({ baseline: echo.baseline, current: echo.current, next: { ...base, name: 'T' }, save: echo.save });
    const later = reconcileServerChange({ baseline: theirs.baseline, current: theirs.current, next: { ...base, name: 'U' }, save: theirs.save });
    expect(theirs.current.name).toBe('T');
    expect(later.current.name).toBe('U');
    expect(later.conflicts).toEqual([]);
    expect([...(later.save?.echoed ?? [])]).toEqual(['name']);
  });

  it('protects an edit made after the echo with a conflict', () => {
    const echo = reconcileServerChange({ baseline: base, current: sent, next: sent, save });
    const change = reconcileServerChange({
      baseline: echo.baseline,
      current: { ...sent, name: 'Mine' },
      next: { ...base, name: 'T' },
      save: echo.save,
    });
    expect(change.current.name).toBe('Mine');
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

describe('a successful save after refetches (rule 3 with the save’s state)', () => {
  const sent = { ...base, name: 'Sent' };

  it('confirms values the form took from the server, not just what was sent', () => {
    const save = { ...startSave(base, sent), echoed: new Set(['name']) };
    const reached = { ...base, name: 'T', slug: 'two' };
    const result = reconcileSaveSuccess({ submitted: sent, current: reached, during: { save, baseline: reached } });
    expect(result.baseline).toEqual(reached);
    expect(isDraftDirty(result.current, result.baseline)).toBe(false);
  });

  it('keeps an edit that differs from what was sent, or from the baseline after the echo', () => {
    const awaiting = startSave(base, sent);
    const before = reconcileSaveSuccess({ submitted: sent, current: base, confirmed: sent, during: { save: awaiting, baseline: base } });
    expect(before.current.name).toBe('Docs');
    const echoed = { ...awaiting, echoed: new Set(['name']) };
    const after = reconcileSaveSuccess({ submitted: sent, current: base, confirmed: sent, during: { save: echoed, baseline: sent } });
    expect(after.current.name).toBe('Docs');
    expect(isDraftDirty(after.current, after.baseline)).toBe(true);
  });
});

describe('a save of a transformed payload (toSent)', () => {
  const trim = (values: Values): Values => ({ ...values, name: values.name.trim() });
  const save = startSave(base, { ...base, name: 'Help  ', slug: 'help' }, trim);

  it('records what was sent and the keys it changed in sent space', () => {
    expect(save.values.name).toBe('Help');
    expect(save.raw.name).toBe('Help  ');
    expect([...save.sent]).toEqual(['name', 'slug']);
    // Only spaces added: nothing new is sent, so no echo is awaited.
    expect([...startSave(base, { ...base, name: 'Docs ' }, trim).sent]).toEqual([]);
  });

  it('takes the transformed value as the echo, and keeps the raw value meanwhile', () => {
    const change = reconcileServerChange({ baseline: base, current: save.raw, next: save.values, save });
    expect(change.conflicts).toEqual([]);
    expect(change.current.name).toBe('Help  ');
    expect([...(change.save?.echoed ?? [])]).toEqual(['name', 'slug']);
    const unrelated = reconcileServerChange({ ...change, next: { ...save.values, tags: ['b'] } });
    expect(unrelated.current).toEqual({ ...save.raw, tags: ['b'] });
    const theirs = reconcileServerChange({ ...change, next: { ...save.values, name: 'Theirs' } });
    expect(theirs.current.name).toBe('Theirs');
    expect(theirs.conflicts).toEqual([]);
  });

  it('confirms the transformed value on success unless the person changed it since', () => {
    const during = { save, baseline: base };
    const confirmed = reconcileSaveSuccess({ submitted: save.values, current: save.raw, during });
    expect(confirmed.current).toEqual(save.values);
    const edited = reconcileSaveSuccess({ submitted: save.values, current: { ...save.raw, name: 'Help 2' }, during });
    expect(edited.current.name).toBe('Help 2');
    expect(isDraftDirty(edited.current, edited.baseline)).toBe(true);
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

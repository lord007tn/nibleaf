import { describe, expect, it } from 'vitest';
import { navFromIds } from './section-nav';

const IDS = ['general', 'members'] as const;

describe('navFromIds', () => {
  it('lists one nav entry per id, in id order', () => {
    expect(navFromIds(IDS, { members: { group: 'workspace' }, general: { group: 'site' } })).toEqual([
      { id: 'general', group: 'site' },
      { id: 'members', group: 'workspace' },
    ]);
  });

  it('rejects a nav that drifts from its id list at type level', () => {
    // These run through `tsc --noEmit`: each line must stay a type error.
    // @ts-expect-error an id without a nav entry
    navFromIds(IDS, { general: { group: 'site' } });
    // @ts-expect-error a nav entry without an id
    navFromIds(IDS, { general: { group: 'site' }, members: { group: 'workspace' }, danger: { group: 'advanced' } });
    expect(true).toBe(true);
  });
});

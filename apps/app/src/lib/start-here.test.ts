import { describe, expect, it } from 'vitest';
import type { Project } from '@/hooks/api/types';
import { isSampleSite, startHereProgress } from './start-here';

const site = (overrides: Partial<Project>): Project => ({
  id: 'site',
  organizationId: 'org',
  name: 'Help Center',
  slug: 'help-center',
  description: null,
  icon: null,
  config: null,
  createdAt: '2026-11-02T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
  _count: { pages: 0, deployments: 0 },
  ...overrides,
});

const sample = site({
  id: 'sample',
  name: 'Documentation',
  description: 'Your first documentation site.',
  createdAt: '2026-11-01T00:00:00.000Z',
  _count: { pages: 6, deployments: 1 },
});

describe('startHereProgress', () => {
  it('recognises the auto-created sample only by its seeded name and description', () => {
    expect(isSampleSite(sample)).toBe(true);
    expect(isSampleSite({ ...sample, name: 'Our help' })).toBe(false);
  });

  it("doesn't credit the user with the sample's seeded pages or automatic publish", () => {
    const progress = startHereProgress([sample], 1);
    expect(progress).toMatchObject({ focus: { id: 'sample' }, hasSample: true, wrote: false, published: false, invited: false, done: 0 });
  });

  it('focuses the newest site the user made and tracks real progress', () => {
    const own = site({ id: 'own', _count: { pages: 2, deployments: 0 } });
    expect(startHereProgress([sample, own], undefined)).toMatchObject({ focus: { id: 'own' }, wrote: true, published: false, done: 1 });
    const published = site({ id: 'own', _count: { pages: 2, deployments: 1 } });
    expect(startHereProgress([sample, published], 2)).toMatchObject({ wrote: true, published: true, invited: true, done: 3 });
  });

  it('counts a second publish of the sample as the user publishing', () => {
    expect(startHereProgress([{ ...sample, _count: { pages: 6, deployments: 2 } }], 1)).toMatchObject({ wrote: true, published: true, done: 2 });
  });

  it('has no focus site when the account has none', () => {
    expect(startHereProgress([], undefined)).toMatchObject({ focus: null, hasSample: false, done: 0 });
  });
});

import { describe, expect, it } from 'vitest';
import type { Project } from '@/hooks/api/types';
import { isSampleSite, type SiteActivity, startHereProgress, startHereRequests } from './start-here';

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
  livePublishes: 0,
  publishing: false,
  ...overrides,
});

const sample = site({
  id: 'sample',
  name: 'Documentation',
  description: 'Your first documentation site.',
  createdAt: '2026-11-01T00:00:00.000Z',
  _count: { pages: 6, deployments: 1 },
});

const deploy = (version: number, commitMessage: string | null = null, createdAt = '2026-11-03T00:00:00.000Z') => ({
  version,
  commitMessage,
  createdAt,
});
const starter = () => deploy(1, 'Publish starter site', '2026-11-01T00:00:02.000Z');
const activity = (entries: Record<string, SiteActivity>) => new Map(Object.entries(entries));

describe('startHereProgress', () => {
  it('recognises the auto-created sample only by its seeded name and description', () => {
    expect(isSampleSite(sample)).toBe(true);
    expect(isSampleSite({ ...sample, name: 'Our help' })).toBe(false);
  });

  it("doesn't credit the user with the sample's seeded pages or automatic publish", () => {
    const seeded = { deployments: [starter()], pages: [{ updatedAt: '2026-11-01T00:00:01.000Z' }] };
    const progress = startHereProgress([sample], 1, activity({ sample: seeded }));
    expect(progress).toMatchObject({
      focus: { id: 'sample' },
      hasSample: true,
      wrote: false,
      published: false,
      invited: false,
      done: 0,
      known: true,
    });
  });

  it('focuses the newest site the user made and tracks real progress', () => {
    const own = site({ id: 'own', _count: { pages: 2, deployments: 0 } });
    expect(startHereProgress([sample, own], undefined)).toMatchObject({ focus: { id: 'own' }, wrote: true, published: false, done: 1 });
    const published = site({ id: 'own', _count: { pages: 2, deployments: 1 }, livePublishes: 1 });
    expect(startHereProgress([sample, published], 2)).toMatchObject({ wrote: true, published: true, invited: true, done: 3, known: true });
  });

  it('counts publishing only from live publishes the sites list reports (failed or running ones are not live)', () => {
    const attempted = site({ id: 'own', _count: { pages: 2, deployments: 3 }, livePublishes: 0, publishing: true });
    expect(startHereProgress([attempted], 1)).toMatchObject({ wrote: true, published: false, done: 1, known: true });
  });

  it('never forgets a live publish, however many sites the account has', () => {
    // SOL-09: the only successful publish is on the sixth (least recently updated) site.
    const attempts = Array.from({ length: 5 }, (_, index) => site({ id: `site-${index}`, _count: { pages: 1, deployments: 2 }, livePublishes: 0 }));
    const live = site({ id: 'oldest', _count: { pages: 1, deployments: 1 }, livePublishes: 1 });
    expect(startHereProgress([...attempts, live], 1)).toMatchObject({ published: true, wrote: true, known: true });
    // …and needs no publish history to know it.
    expect(startHereRequests([sample, ...attempts, live])).toEqual({ deploymentSiteIds: [], pageSiteIds: [] });
  });

  it('keeps the checklist unknown (hidden) until every answer has arrived', () => {
    const own = site({ id: 'own', _count: { pages: 2, deployments: 1 }, livePublishes: 1 });
    // Team size still loading.
    expect(startHereProgress([own], undefined)).toMatchObject({ known: false });
    // A sites list without the publish summary can't say whether anything went live.
    expect(startHereProgress([{ ...own, livePublishes: undefined }], 1)).toMatchObject({ published: false, known: false });
    // The sample's pages haven't loaded yet, so writing is not settled.
    expect(startHereProgress([sample], 1)).toMatchObject({ wrote: false, known: false });
    expect(startHereProgress([sample], 1, activity({ sample: { pages: [] } }))).toMatchObject({ known: false });
    expect(startHereProgress([sample], 1, activity({ sample: { pages: [], deployments: [starter()] } }))).toMatchObject({ known: true });
  });

  it('ticks writing once the user changes or adds a page in the sample', () => {
    const edited = { deployments: [starter()], pages: [{ updatedAt: '2026-11-01T00:00:01.000Z' }, { updatedAt: '2026-11-01T00:05:00.000Z' }] };
    expect(startHereProgress([sample], 1, activity({ sample: edited }))).toMatchObject({ wrote: true, published: false, done: 1 });
  });

  it('counts a live publish of the sample beyond its automatic one', () => {
    expect(startHereProgress([{ ...sample, livePublishes: 1 }], 1)).toMatchObject({ wrote: true, published: true, done: 2, known: true });
  });

  it('waits for the sample publish history before judging edits, and falls back to a seeding window without one', () => {
    const pages = [{ updatedAt: '2026-11-01T00:00:30.000Z' }];
    expect(startHereProgress([sample], 1, activity({ sample: { pages } }))).toMatchObject({ wrote: false, known: false });
    const neverPublished = { ...sample, _count: { pages: 6, deployments: 0 } };
    expect(startHereProgress([neverPublished], 1, activity({ sample: { pages } }))).toMatchObject({ wrote: false, known: true });
    expect(startHereProgress([neverPublished], 1, activity({ sample: { pages: [{ updatedAt: '2026-11-01T00:02:00.000Z' }] } }))).toMatchObject({
      wrote: true,
    });
  });

  it('has no focus site when the account has none', () => {
    expect(startHereProgress([], undefined)).toMatchObject({ focus: null, hasSample: false, done: 0 });
  });
});

describe('startHereRequests', () => {
  it('reads only the sample, and only until the user writes in their own site or publishes', () => {
    const fresh = site({ id: 'fresh', createdAt: '2026-11-04T00:00:00.000Z' });
    expect(startHereRequests([sample, fresh])).toEqual({ deploymentSiteIds: ['sample'], pageSiteIds: ['sample'] });
    expect(startHereRequests([{ ...sample, _count: { pages: 6, deployments: 0 } }])).toEqual({ deploymentSiteIds: [], pageSiteIds: ['sample'] });
    expect(startHereRequests([sample, { ...fresh, _count: { pages: 1, deployments: 0 } }])).toEqual({ deploymentSiteIds: [], pageSiteIds: [] });
    expect(startHereRequests([sample, { ...fresh, livePublishes: 1 }])).toEqual({ deploymentSiteIds: [], pageSiteIds: [] });
    expect(startHereRequests([fresh])).toEqual({ deploymentSiteIds: [], pageSiteIds: [] });
  });
});

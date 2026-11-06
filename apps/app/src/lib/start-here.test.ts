import { describe, expect, it } from 'vitest';
import type { Project } from '@/hooks/api/types';
import { isSampleSite, type SiteActivity, START_HERE_MAX_SITES, startHereProgress, startHereRequests } from './start-here';

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

type Status = 'PENDING' | 'BUILDING' | 'READY' | 'FAILED';
const deploy = (version: number, status: Status, commitMessage: string | null = null, createdAt = '2026-11-03T00:00:00.000Z') => ({
  version,
  status,
  commitMessage,
  createdAt,
});
const starter = (status: Status = 'READY') => deploy(1, status, 'Publish starter site', '2026-11-01T00:00:02.000Z');
const activity = (entries: Record<string, SiteActivity>) => new Map(Object.entries(entries));

describe('startHereProgress', () => {
  it('recognises the auto-created sample only by its seeded name and description', () => {
    expect(isSampleSite(sample)).toBe(true);
    expect(isSampleSite({ ...sample, name: 'Our help' })).toBe(false);
  });

  it("doesn't credit the user with the sample's seeded pages or automatic publish", () => {
    const seeded = { deployments: [starter()], pages: [{ updatedAt: '2026-11-01T00:00:01.000Z' }] };
    const progress = startHereProgress([sample], 1, activity({ sample: seeded }));
    expect(progress).toMatchObject({ focus: { id: 'sample' }, hasSample: true, wrote: false, published: false, invited: false, done: 0 });
  });

  it('focuses the newest site the user made and tracks real progress', () => {
    const own = site({ id: 'own', _count: { pages: 2, deployments: 0 } });
    expect(startHereProgress([sample, own], undefined)).toMatchObject({ focus: { id: 'own' }, wrote: true, published: false, done: 1 });
    const published = site({ id: 'own', _count: { pages: 2, deployments: 1 } });
    expect(startHereProgress([sample, published], 2, activity({ own: { deployments: [deploy(1, 'READY')] } }))).toMatchObject({
      wrote: true,
      published: true,
      invited: true,
      done: 3,
    });
  });

  it.each<Status>(['FAILED', 'PENDING', 'BUILDING'])('does not count a %s publish of your own site as publishing', (status) => {
    const own = site({ id: 'own', _count: { pages: 2, deployments: 1 } });
    expect(startHereProgress([own], 1, activity({ own: { deployments: [deploy(1, status)] } }))).toMatchObject({
      wrote: true,
      published: false,
      done: 1,
    });
  });

  it('does not tick publishing from a deployment count before the publish history has loaded', () => {
    const own = site({ id: 'own', _count: { pages: 2, deployments: 3 } });
    expect(startHereProgress([own], 1)).toMatchObject({ published: false });
  });

  it('counts a later publish of the sample only once it went live', () => {
    const sampleTwice = { ...sample, _count: { pages: 6, deployments: 2 } };
    const failed = activity({ sample: { deployments: [deploy(2, 'FAILED'), starter()] } });
    expect(startHereProgress([sampleTwice], 1, failed)).toMatchObject({ wrote: false, published: false, done: 0 });
    const live = activity({ sample: { deployments: [deploy(2, 'READY'), starter()] } });
    expect(startHereProgress([sampleTwice], 1, live)).toMatchObject({ wrote: true, published: true, done: 2 });
  });

  it("counts the user's first publish of a sample whose automatic publish never happened", () => {
    expect(startHereProgress([sample], 1, activity({ sample: { deployments: [deploy(1, 'READY', 'Fix typo')] } }))).toMatchObject({
      published: true,
    });
  });

  it('ticks writing once the user changes or adds a page in the sample', () => {
    const edited = { deployments: [starter()], pages: [{ updatedAt: '2026-11-01T00:00:01.000Z' }, { updatedAt: '2026-11-01T00:05:00.000Z' }] };
    expect(startHereProgress([sample], 1, activity({ sample: edited }))).toMatchObject({ wrote: true, published: false, done: 1 });
  });

  it('waits for the sample publish history before judging edits, and falls back to a seeding window without one', () => {
    const pages = [{ updatedAt: '2026-11-01T00:00:30.000Z' }];
    expect(startHereProgress([sample], 1, activity({ sample: { pages } }))).toMatchObject({ wrote: false });
    const neverPublished = { ...sample, _count: { pages: 6, deployments: 0 } };
    expect(startHereProgress([neverPublished], 1, activity({ sample: { pages } }))).toMatchObject({ wrote: false });
    expect(startHereProgress([neverPublished], 1, activity({ sample: { pages: [{ updatedAt: '2026-11-01T00:02:00.000Z' }] } }))).toMatchObject({
      wrote: true,
    });
  });

  it('has no focus site when the account has none', () => {
    expect(startHereProgress([], undefined)).toMatchObject({ focus: null, hasSample: false, done: 0 });
  });
});

describe('startHereRequests', () => {
  it('reads the focus site and every site that started a publish, and the sample pages until the user writes elsewhere', () => {
    const fresh = site({ id: 'fresh', createdAt: '2026-11-04T00:00:00.000Z' });
    const quiet = site({ id: 'quiet', createdAt: '2026-11-03T00:00:00.000Z' });
    expect(startHereRequests([sample, fresh, quiet])).toEqual({ deploymentSiteIds: ['sample', 'fresh'], pageSiteIds: ['sample'] });
    const writing = { ...fresh, _count: { pages: 1, deployments: 0 } };
    expect(startHereRequests([sample, writing]).pageSiteIds).toEqual([]);
  });

  it('caps how many publish histories the dashboard loads', () => {
    const many = Array.from({ length: START_HERE_MAX_SITES + 3 }, (_, index) => site({ id: `site-${index}`, _count: { pages: 1, deployments: 1 } }));
    expect(startHereRequests(many).deploymentSiteIds).toHaveLength(START_HERE_MAX_SITES);
  });
});

import { describe, expect, it } from 'vitest';
import type { SiteSnapshot, SnapshotPage } from './site';
import { createLinkResolver, createLinkTargetResolver } from './site-links';

/*
 * #553 (council): a link through a redirect lands where the published
 * redirect lands. The reader answers a redirect with a Location that keeps the
 * configured fragment, and a browser follows it: a Location's fragment replaces
 * the one the link carried, and a Location without one keeps it, hop by hop.
 */

const page = (id: string, path: string): SnapshotPage => ({
  id,
  parentId: null,
  versionId: 'v1',
  updatedAt: '2026-11-01T00:00:00.000Z',
  languageCode: 'en',
  kind: 'PAGE',
  title: id,
  path,
  slug: path.split('/').at(-1) ?? '',
  icon: null,
  description: null,
  content: 'Body.',
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
});

const snapshot: SiteSnapshot = {
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: {
      redirects: [
        { from: '/old-setup', to: '/guide/setup' },
        { from: '/old-install', to: '/guide/setup#install' },
        { from: '/install-alias', to: '/old-install' },
        { from: '/legacy-options', to: '/moved-options#legacy' },
        { from: '/moved-options', to: '/configuration#options' },
      ],
    },
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
    versions: [{ id: 'v1', name: 'Latest', slug: 'latest', isDefault: true }],
  },
  pages: [page('start', 'start'), page('setup', 'guide/setup'), page('configuration', 'configuration')],
  generatedAt: '2026-11-01T00:00:00.000Z',
};
const from = snapshot.pages[0] as SnapshotPage;

describe('link targets keep the fragment the reader lands on (#553)', () => {
  const resolve = (href: string) => {
    const reached = createLinkTargetResolver(snapshot)(href, from);
    return reached && { page: typeof reached.destination === 'object' ? reached.destination.id : reached.destination, fragment: reached.fragment };
  };

  it('a redirect’s fragment is the one the reader lands on', () => {
    expect(resolve('/old-install')).toEqual({ page: 'setup', fragment: 'install' });
  });

  it('a redirect’s fragment replaces the link’s own', () => {
    expect(resolve('/old-install#other')).toEqual({ page: 'setup', fragment: 'install' });
  });

  it('a chain keeps the last fragment set on the way', () => {
    expect(resolve('/install-alias')).toEqual({ page: 'setup', fragment: 'install' });
    expect(resolve('/install-alias#other')).toEqual({ page: 'setup', fragment: 'install' });
    expect(resolve('/legacy-options')).toEqual({ page: 'configuration', fragment: 'options' });
  });

  it('with no redirect fragment, the link’s own is kept', () => {
    expect(resolve('/old-setup#other')).toEqual({ page: 'setup', fragment: 'other' });
    expect(resolve('/guide/setup#install')).toEqual({ page: 'setup', fragment: 'install' });
    expect(resolve('/old-setup')).toEqual({ page: 'setup', fragment: undefined });
    expect(resolve('/guide/setup#')).toEqual({ page: 'setup', fragment: undefined });
  });

  it('a cached destination does not leak one link’s fragment into another', () => {
    const resolveLink = createLinkTargetResolver(snapshot);
    expect(resolveLink('/old-setup#first', from)?.fragment).toBe('first');
    expect(resolveLink('/old-setup', from)?.fragment).toBeUndefined();
  });

  it('createLinkResolver still answers with the destination only', () => {
    const resolveLink = createLinkResolver(snapshot);
    expect(resolveLink('/old-install#other', from)).toMatchObject({ id: 'setup' });
    expect(resolveLink('/nowhere', from)).toBe(false);
    expect(resolveLink('#top', from)).toBeNull();
  });
});

it('keeps the full content path of absolute legacy query links', () => {
  const target = { ...page('arabic-nested', 'ar/guide'), languageCode: 'ar' };
  const bilingual: SiteSnapshot = {
    ...snapshot,
    project: {
      ...snapshot.project,
      languages: [...snapshot.project.languages, { code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, config: null }],
    },
    pages: [...snapshot.pages, target],
  };
  expect(createLinkTargetResolver(bilingual)('/ar/guide?lang=ar#install', from, true)).toEqual({ destination: target, fragment: 'install' });
});

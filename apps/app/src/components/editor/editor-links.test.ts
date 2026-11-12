import { describe, expect, it } from 'vitest';
import type { Branch, Language, PageNode, Project } from '@/hooks/api/types';
import { editorLinkResolver, editorSiteSnapshot, isWebAddress } from './editor-links';

/**
 * PUBLIC-18: a link to another page of the site is stored relative. The editor
 * resolves it the way the published site does (the publish checks' resolver),
 * so it can open that page instead of the dashboard's own address.
 */

const project: Pick<Project, 'id' | 'name' | 'slug' | 'description' | 'icon' | 'config'> = {
  id: 'project-1',
  name: 'Docs',
  slug: 'docs',
  description: null,
  icon: null,
  config: { redirects: [{ from: 'old-setup', to: 'guides/setup' }] } as Project['config'],
};
const languages: Pick<Language, 'id' | 'code' | 'label' | 'direction' | 'isDefault' | 'config'>[] = [
  { id: 'lang-en', code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
  // Not served yet: its pages are still edited, and still link targets in the editor.
  { id: 'lang-ar', code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null },
];
const branches: Pick<Branch, 'id' | 'name' | 'isDefault' | 'createdAt'>[] = [
  { id: 'v2', name: 'v2', isDefault: false, createdAt: '2026-02-01T00:00:00.000Z' },
  { id: 'main', name: 'main', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
];

let position = 0;
const node = (id: string, path: string, overrides: Partial<PageNode> = {}): PageNode => ({
  id,
  parentId: null,
  branchId: 'main',
  languageId: 'lang-en',
  kind: 'PAGE',
  title: id,
  slug: path.split('/').at(-1) ?? path,
  path,
  icon: null,
  description: null,
  position: position++,
  hidden: false,
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

const pages = [
  node('intro', 'guides/intro'),
  node('setup', 'guides/setup'),
  node('configuration', 'configuration'),
  node('limits', 'reference/limits'),
  node('draft', 'draft-notes', { hidden: true }),
  node('ar-intro', 'guides/intro', { languageId: 'lang-ar', title: 'مقدمة' }),
  node('ar-configuration', 'configuration', { languageId: 'lang-ar', title: 'الإعدادات' }),
];

const resolveFrom = (pageId: string, site = editorSiteSnapshot({ project, languages, branches, pages, branchId: 'main' })) =>
  editorLinkResolver(site, pageId);

describe('editor link resolution (PUBLIC-18)', () => {
  it('resolves a relative link against the open page', () => {
    const resolve = resolveFrom('intro');
    expect(resolve('setup')).toEqual({ kind: 'page', pageId: 'setup' });
    expect(resolve('./setup')).toEqual({ kind: 'page', pageId: 'setup' });
    expect(resolve('../reference/limits')).toEqual({ kind: 'page', pageId: 'limits' });
  });

  it('resolves a link from the site root', () => {
    const resolve = resolveFrom('intro');
    expect(resolve('/configuration')).toEqual({ kind: 'page', pageId: 'configuration' });
    expect(resolve('/guides/setup')).toEqual({ kind: 'page', pageId: 'setup' });
  });

  it('resolves the page of a link with an #anchor', () => {
    const resolve = resolveFrom('intro');
    expect(resolve('/configuration#options')).toEqual({ kind: 'page', pageId: 'configuration' });
    expect(resolve('setup#install')).toEqual({ kind: 'page', pageId: 'setup' });
  });

  it('follows a redirect from an old address to the page', () => {
    expect(resolveFrom('intro')('/old-setup')).toEqual({ kind: 'page', pageId: 'setup' });
  });

  it('says a link that reaches no page is missing', () => {
    const resolve = resolveFrom('intro');
    expect(resolve('/nowhere')).toEqual({ kind: 'missing' });
    expect(resolve('installation')).toEqual({ kind: 'missing' });
  });

  it('resolves a link in another language to that language’s page', () => {
    const resolve = resolveFrom('ar-intro');
    expect(resolve('/configuration')).toEqual({ kind: 'page', pageId: 'ar-configuration' });
    // A page the translation lacks falls back to the default language, as on the site.
    expect(resolve('/guides/setup')).toEqual({ kind: 'page', pageId: 'setup' });
  });

  it('opens hidden pages, which the writer still edits', () => {
    expect(resolveFrom('intro')('/draft-notes')).toEqual({ kind: 'page', pageId: 'draft' });
  });

  it('leaves web addresses to the browser', () => {
    const resolve = resolveFrom('intro');
    expect(resolve('https://example.com/docs')).toEqual({ kind: 'web' });
    expect(resolve('mailto:team@example.com')).toEqual({ kind: 'web' });
    expect(isWebAddress('//cdn.example.com/a.png')).toBe(true);
    expect(isWebAddress('/configuration')).toBe(false);
    expect(isWebAddress('configuration')).toBe(false);
  });

  it('does not open in-page anchors and files as pages', () => {
    const resolve = resolveFrom('intro');
    expect(resolve('#options')).toEqual({ kind: 'other' });
    expect(resolve('/files/guide.pdf')).toEqual({ kind: 'other' });
  });

  it('resolves inside the docs version being edited', () => {
    const v2Pages = [node('v2-intro', 'guides/intro', { branchId: 'v2' }), node('v2-new', 'new-in-v2', { branchId: 'v2' })];
    const site = editorSiteSnapshot({ project, languages, branches, pages: v2Pages, branchId: 'v2' });
    expect(resolveFrom('v2-intro', site)('/new-in-v2')).toEqual({ kind: 'page', pageId: 'v2-new' });
  });

  it('claims nothing about a site link while the pages load', () => {
    expect(editorLinkResolver(null, 'intro')('/configuration')).toEqual({ kind: 'unknown' });
    expect(editorLinkResolver(null, 'intro')('https://example.com')).toEqual({ kind: 'web' });
  });

  it('describes no site without a default language', () => {
    const noDefault = languages.map((language) => ({ ...language, isDefault: false }));
    expect(editorSiteSnapshot({ project, languages: noDefault, branches, pages, branchId: 'main' })).toBeNull();
  });
});

import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { describe, expect, it } from 'vitest';
import { previewScope } from './git-preview';

const page = (id: string, languageCode: string, versionId: string, extra: Partial<SnapshotPage> = {}): SnapshotPage => ({
  id,
  parentId: null,
  versionId,
  updatedAt: '2026-11-01T00:00:00.000Z',
  languageCode,
  kind: 'PAGE',
  title: 'Setup',
  slug: 'setup',
  path: 'setup',
  icon: null,
  description: null,
  content: '',
  config: null,
  translationKey: 'setup',
  position: 0,
  hidden: false,
  ...extra,
});

const snapshot = (pages: SnapshotPage[]) =>
  ({
    project: {
      id: 'docs',
      name: 'Docs',
      slug: 'docs',
      description: null,
      icon: null,
      config: null,
      languages: [
        { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
        { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null },
        { code: 'fr', label: 'Français', direction: 'LTR', isDefault: false, config: null },
      ],
      versions: [
        { id: 'v1', name: 'v1', slug: 'v1', isDefault: true },
        { id: 'v2', name: 'v2', slug: 'v2', isDefault: false },
      ],
    },
    pages,
    generatedAt: '2026-11-01T00:00:00.000Z',
  }) as SiteSnapshot;

describe('previewScope', () => {
  const all = snapshot([page('en-1', 'en', 'v1'), page('ar-1', 'ar', 'v1'), page('en-2', 'en', 'v2'), page('ar-2', 'ar', 'v2')]);

  it('starts on the default language and version, one copy of each title', () => {
    const scope = previewScope(all);
    expect(scope.language?.code).toBe('en');
    expect(scope.version?.id).toBe('v1');
    expect(scope.pages.map((item) => item.id)).toEqual(['en-1']);
  });

  it('opens the requested language and version', () => {
    expect(previewScope(all, { language: 'ar', versionId: 'v2' }).pages.map((item) => item.id)).toEqual(['ar-2']);
  });

  it('offers only languages and versions that have visible pages, and falls back from unknown ones', () => {
    const scope = previewScope(all, { language: 'xx', versionId: 'gone' });
    expect(scope.languages.map((item) => item.code)).toEqual(['en', 'ar']);
    expect(scope.versions.map((item) => item.id)).toEqual(['v1', 'v2']);
    expect(scope.language?.code).toBe('en');
    expect(scope.version?.id).toBe('v1');
  });

  it('leaves out groups and hidden pages, and starts elsewhere when the default has none', () => {
    const scope = previewScope(
      snapshot([page('group', 'en', 'v1', { kind: 'GROUP' }), page('hidden', 'en', 'v1', { hidden: true }), page('ar-2', 'ar', 'v2')]),
    );
    expect(scope.language?.code).toBe('ar');
    expect(scope.version?.id).toBe('v2');
    expect(scope.pages.map((item) => item.id)).toEqual(['ar-2']);
  });

  it('has no scope at all for an empty snapshot', () => {
    expect(previewScope(snapshot([]))).toMatchObject({ language: undefined, version: undefined, pages: [] });
  });
});

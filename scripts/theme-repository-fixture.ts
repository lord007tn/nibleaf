import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { SiteSnapshot } from '../packages/shared/src/site';
import { buildThemeRepository, themeContentPath } from '../packages/shared/src/theme-repository';
import { THEME_PRESET_IDS, type ThemePresetId } from '../packages/shared/src/themes';

const targetArg = process.argv[2];
const templateArg = process.argv[3] ?? 'harbor';
if (!targetArg || !THEME_PRESET_IDS.includes(templateArg as ThemePresetId)) {
  throw new Error('Usage: pnpm theme-repository:fixture <new-output-directory> [harbor|manuscript|signal]');
}
const target = resolve(targetArg);
const template = templateArg as ThemePresetId;

const snapshot: SiteSnapshot = {
  project: {
    id: 'fixture_harbor',
    name: 'Northstar Developer Docs',
    slug: 'northstar-docs',
    description: 'Ship reliable integrations with a documentation repository your team owns.',
    icon: null,
    config: { theme: { preset: template } },
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null },
      { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, enabled: true, config: null },
    ],
    versions: [{ id: 'version_main', name: 'Main', slug: 'main', isDefault: true }],
  },
  pages: [
    {
      id: 'welcome-en',
      parentId: null,
      versionId: 'version_main',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
      languageCode: 'en',
      kind: 'PAGE',
      title: 'Build with Northstar',
      slug: 'welcome',
      path: '/welcome',
      icon: null,
      description: 'Everything you need to authenticate, make your first request, and ship with confidence.',
      content:
        '## Overview\n\nNorthstar gives your team a predictable API and a Git-native documentation workflow.\n\n```ts\nconst client = createClient({ token: process.env.NORTHSTAR_TOKEN });\n```\n\n## Next steps\n\n- Create a test workspace\n- Send your first request\n- Review production guidance',
      config: null,
      translationKey: 'welcome',
      position: 0,
      hidden: false,
    },
    {
      id: 'auth-en',
      parentId: null,
      versionId: 'version_main',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
      languageCode: 'en',
      kind: 'PAGE',
      title: 'Authentication',
      slug: 'authentication',
      path: '/authentication',
      icon: null,
      description: 'Keep credentials server-side and rotate them safely.',
      content: '## API keys\n\nUse a separate key for every environment.',
      config: null,
      translationKey: 'authentication',
      position: 1,
      hidden: false,
    },
    {
      id: 'welcome-ar',
      parentId: null,
      versionId: 'version_main',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
      languageCode: 'ar',
      kind: 'PAGE',
      title: 'ابدأ مع نورث ستار',
      slug: 'welcome-ar',
      path: '/ar/welcome',
      icon: null,
      description: 'كل ما تحتاجه للمصادقة وإرسال طلبك الأول بثقة.',
      content: '## نظرة عامة\n\nتمنحك نورث ستار واجهة برمجية واضحة وسير عمل توثيق يعتمد على Git.',
      config: null,
      translationKey: 'welcome',
      position: 2,
      hidden: false,
    },
  ],
  generatedAt: '2026-08-23T00:00:00.000Z',
};

await mkdir(target);
for (const file of buildThemeRepository(snapshot)) {
  const path = resolve(target, file.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.content, 'utf8');
}
for (const page of snapshot.pages) {
  const path = resolve(target, themeContentPath(page, snapshot));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `---\ntitle: ${JSON.stringify(page.title)}\n---\n\n${page.content}\n`, 'utf8');
}
process.stdout.write(`${target}\n`);

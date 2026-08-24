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
    versions: [
      { id: 'version_main', name: 'Main', slug: 'main', isDefault: true },
      { id: 'version_next', name: 'Next', slug: 'next', isDefault: false },
    ],
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
      content: `## Overview

Northstar gives your team a predictable API and a Git-native documentation workflow. Keep the <Tooltip tip="Auth token">credential</Tooltip> private <Icon icon="star" />.

<Callout type="tip">

**Portable callout:** Preview the exact change before publishing a new immutable deployment.

</Callout>

<Tabs>
  <Tab title="TypeScript">

\`\`\`ts
const client = createClient({ token: process.env.NORTHSTAR_TOKEN });
\`\`\`

  </Tab>
  <Tab title="cURL">

\`\`\`bash
curl https://api.northstar.example/v1/projects
\`\`\`

  </Tab>
</Tabs>

<FileTree>
  <Folder name="src" defaultOpen>
    <File name="client.ts" />
    <File name="types.ts" />
  </Folder>
  <File name="package.json" />
</FileTree>

<ApiExample title="Create a project">
  <RequestExample title="Request">

\`\`\`json
{ "name": "Northstar" }
\`\`\`

  </RequestExample>
  <ResponseExample title="Response" status="201">

\`\`\`json
{ "id": "project_123" }
\`\`\`

  </ResponseExample>
</ApiExample>

## Next steps

<RelatedContent title="Continue building">
  <RelatedCard title="Authentication" description="Keep credentials server-side." href="/authentication" />
  <RelatedCard title="Production checklist" description="Review rollout and rollback guidance." href="/production" />
</RelatedContent>`,
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
      content: `## نظرة عامة

تمنحك نورث ستار واجهة برمجية واضحة وسير عمل توثيق يعتمد على Git.

<Callout type="tip">

**تنبيه قابل للنقل:** عاين التغيير بدقة قبل نشر إصدار ثابت جديد.

</Callout>

<FileTree>
  <Folder name="src" defaultOpen>
    <File name="client.ts" />
    <File name="types.ts" />
  </Folder>
  <File name="package.json" />
</FileTree>

<RelatedContent title="تابع البناء">
  <RelatedCard title="المصادقة" description="احتفظ ببيانات الاعتماد في الخادم." href="/ar/authentication" />
</RelatedContent>`,
      config: null,
      translationKey: 'welcome',
      position: 2,
      hidden: false,
    },
    {
      id: 'next-en',
      parentId: null,
      versionId: 'version_next',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
      languageCode: 'en',
      kind: 'PAGE',
      title: 'Next release guide',
      slug: 'next-release',
      path: '/next-release',
      icon: null,
      description: 'Preview the next API version without mixing it into the current documentation tree.',
      content:
        '## Overview\n\nThis page belongs only to the Next version.\n\n## Next steps\n\nSwitch back to Main when you need the stable reference.',
      config: null,
      translationKey: 'next-release',
      position: 3,
      hidden: false,
    },
    {
      id: 'auth-ar',
      parentId: null,
      versionId: 'version_main',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
      languageCode: 'ar',
      kind: 'PAGE',
      title: 'المصادقة',
      slug: 'authentication-ar',
      path: '/ar/authentication',
      icon: null,
      description: 'احتفظ ببيانات الاعتماد في الخادم.',
      content: '## نظرة عامة\n\nاستخدم رمز وصول قصير العمر لكل طلب.\n\n## الخطوات التالية\n\nتحقق من الصلاحيات قبل استدعاء الواجهة.',
      config: null,
      translationKey: 'authentication',
      position: 3,
      hidden: false,
    },
    {
      id: 'next-ar',
      parentId: null,
      versionId: 'version_next',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
      languageCode: 'ar',
      kind: 'PAGE',
      title: 'دليل الإصدار التالي',
      slug: 'next-release-ar',
      path: '/ar/next-release',
      icon: null,
      description: 'عاين الإصدار التالي من الواجهة دون خلطه مع شجرة التوثيق الحالية.',
      content:
        '## نظرة عامة\n\nتنتمي هذه الصفحة إلى الإصدار التالي فقط.\n\n## الخطوات التالية\n\nارجع إلى الإصدار الرئيسي عند الحاجة إلى المرجع المستقر.',
      config: null,
      translationKey: 'next-release',
      position: 5,
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

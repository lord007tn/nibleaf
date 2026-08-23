import type { SiteSnapshot } from '@nibleaf/shared/site';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { renderMarkdownZip, renderPageMarkdown, renderPdfHtml, renderStaticHtml, selectPublishedAssets } from './render';

const snapshot: SiteSnapshot = {
  project: {
    id: 'project_public',
    name: 'دليل المنتج',
    slug: 'guide',
    description: 'Published docs',
    icon: null,
    config: null,
    languages: [{ code: 'ar', label: 'العربية', direction: 'RTL', isDefault: true, enabled: true, config: null }],
    versions: [{ id: 'branch_main', name: 'main', slug: 'main', isDefault: true }],
  },
  generatedAt: '2026-08-16T00:00:00.000Z',
  pages: [
    {
      id: 'intro',
      parentId: null,
      versionId: 'branch_main',
      languageCode: 'ar',
      kind: 'PAGE',
      title: 'مقدمة',
      slug: 'intro',
      path: 'intro',
      icon: null,
      description: null,
      content:
        '# أهلاً\n\n[التالي](/setup)\n\n![صورة](/api/public/assets/projects/project_public/assets/logo.png)\n\n<script>globalThis.stolen=true</script>',
      config: null,
      translationKey: null,
      position: 0,
      hidden: false,
      updatedAt: '2026-08-16T00:00:00.000Z',
    },
    {
      id: 'setup',
      parentId: null,
      versionId: 'branch_main',
      languageCode: 'ar',
      kind: 'PAGE',
      title: 'الإعداد',
      slug: 'setup',
      path: 'setup',
      icon: null,
      description: null,
      content: '| أ | ب |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst ok = true\n```',
      config: null,
      translationKey: null,
      position: 1,
      hidden: false,
      updatedAt: '2026-08-16T00:00:00.000Z',
    },
  ],
};

const themedSnapshot: SiteSnapshot = {
  ...snapshot,
  project: {
    ...snapshot.project,
    config: {
      theme: {
        preset: 'signal',
        colors: { light: { accent: '#4f46e5', accentForeground: '#ffffff', focus: '#4f46e5' } },
      },
      styling: { theme: 'light' },
      typography: { bodyFont: 'نسق عربي', headingFont: 'Noto Sans Arabic', codeFont: 'JetBrains Mono', baseSize: '17', leading: '1.9' },
    },
  },
};

const assets = [
  {
    key: 'projects/project_public/assets/logo.png',
    url: '/api/public/assets/projects/project_public/assets/logo.png',
    contentType: 'image/png',
    bytes: new Uint8Array([1, 2, 3]),
  },
];

const text = (value: Uint8Array) => new TextDecoder().decode(value);
const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Expected test fixture value.');
  return value;
};

describe('export renderers', () => {
  it('rewrites internal links and allowlisted assets for offline static output', () => {
    const files = unzipSync(renderStaticHtml(snapshot, assets).bytes);
    const intro = text(required(files['main/ar/intro/index.html']));
    expect(intro).toContain('href="../setup/index.html"');
    expect(intro).toContain('src="../../../assets/logo.png"');
    expect(intro).toContain('dir="rtl"');
    expect(files['theme/theme.css']).toBeDefined();
    expect(files['theme/theme.js']).toBeDefined();
    expect(files['assets/logo.png']).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('projects the immutable deployment theme into static, PDF, and Markdown artifacts', () => {
    const staticFiles = unzipSync(renderStaticHtml(themedSnapshot, assets).bytes);
    expect(text(required(staticFiles['theme/theme.css']))).toContain('--accent:#4f46e5');
    expect(text(required(staticFiles['theme/theme.css']))).toContain("--font-body:'نسق عربي'");
    expect(text(required(staticFiles['theme/theme.css']))).toContain('--font-size:17px');
    expect(text(required(staticFiles['main/ar/intro/index.html']))).toContain('data-theme-id="signal"');
    expect(text(required(staticFiles['main/ar/intro/index.html']))).toContain('data-theme-shell="console"');
    expect(renderPdfHtml(themedSnapshot, assets)).toContain('--accent:#4f46e5');

    const markdownFiles = unzipSync(renderMarkdownZip(themedSnapshot, assets).bytes);
    expect(JSON.parse(text(required(markdownFiles['project.json'])))).toMatchObject({
      themeTemplate: { kind: 'nibleaf-theme', version: 1, config: { theme: { preset: 'signal' } } },
    });
  });

  it('does not execute raw published HTML in static archives', () => {
    const html = renderPageMarkdown(snapshot, required(snapshot.pages[0]), assets);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes malformed legacy theme values in static HTML attributes', () => {
    const malformed = {
      ...themedSnapshot,
      project: {
        ...themedSnapshot.project,
        config: {
          ...themedSnapshot.project.config,
          theme: {
            preset: 'signal',
            layout: { sidebar: 'soft" onmouseover="alert(1)' },
            components: { callouts: 'solid" autofocus="true' },
          },
        },
      },
    } as SiteSnapshot;
    const files = unzipSync(renderStaticHtml(malformed, assets).bytes);
    const html = text(required(files['main/ar/intro/index.html']));
    expect(html).not.toContain(' onmouseover="');
    expect(html).not.toContain(' autofocus="');
    expect(html).toContain('soft&quot; onmouseover=&quot;alert(1)');
    expect(html).toContain('solid&quot; autofocus=&quot;true');
  });

  it('sanitizes malformed legacy typography in static and PDF CSS', () => {
    const malformed = {
      ...themedSnapshot,
      project: {
        ...themedSnapshot.project,
        config: {
          ...themedSnapshot.project.config,
          typography: {
            baseSize: '17;}body{display:none',
            leading: '1.9;}html{display:none',
            flow: '1.25;}main{display:none',
          },
        },
      },
    } as SiteSnapshot;
    const files = unzipSync(renderStaticHtml(malformed, assets).bytes);
    const outputs = [text(required(files['theme/theme.css'])), renderPdfHtml(malformed, assets)];
    for (const output of outputs) {
      expect(output).not.toContain('display:none');
      expect(output).toContain('--font-size:15px');
      expect(output).toContain('--leading:1.6');
      expect(output).toContain('--flow:1em');
    }
  });

  it('omits hidden pages from static files and the offline search index', () => {
    const hidden = {
      ...required(snapshot.pages[1]),
      id: 'internal-plan',
      title: 'Internal launch plan',
      slug: 'internal-plan',
      path: 'internal-plan',
      content: 'Embargoed roadmap details',
      hidden: true,
    };
    const files = unzipSync(renderStaticHtml({ ...snapshot, pages: [...snapshot.pages, hidden] }, assets).bytes);

    expect(files['main/ar/internal-plan/index.html']).toBeUndefined();
    expect(text(required(files['theme/theme.js']))).not.toContain('Embargoed roadmap details');
  });

  it('produces PDF source with RTL, tables, code, page breaks, links, and metadata', () => {
    const html = renderPdfHtml(snapshot, assets);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('<table>');
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain('page-break-inside:avoid');
    expect(html).toContain('href="#page-setup"');
    expect(html).toContain('<meta name="generator" content="Nibleaf export">');
    expect(html).toContain('data:image/png;base64,AQID');
  });

  it('retains Markdown and published metadata in a snapshot-backed zip', () => {
    const files = unzipSync(renderMarkdownZip(snapshot, assets).bytes);
    expect(text(required(files['main/ar/intro.md']))).toContain('[التالي](/setup)');
    expect(JSON.parse(text(required(files['project.json'])))).toMatchObject({ slug: 'guide', publishedAt: snapshot.generatedAt, pagesCount: 2 });
  });

  it('excludes draft-only assets and rejects a large published asset set', () => {
    const manifest = [
      { ...required(assets[0]), size: 3 },
      {
        key: 'projects/project_public/assets/private.png',
        url: '/api/public/assets/projects/project_public/assets/private.png',
        contentType: 'image/png',
        size: 1,
      },
    ];
    expect(selectPublishedAssets(snapshot, manifest, 3).map((asset) => asset.key)).toEqual([required(assets[0]).key]);
    expect(() => selectPublishedAssets(snapshot, manifest, 2)).toThrow('2-byte limit');
  });
});

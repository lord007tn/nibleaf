import type { SiteSnapshot } from '@nibleaf/shared/site';
import { THEME_PRESET_IDS } from '@nibleaf/shared/themes';
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

  it('renders Harbor, Manuscript, and Signal as structurally distinct responsive documents', () => {
    const expected = {
      harbor: ['harbor-topbar', 'harbor-library', 'harbor-toc'],
      manuscript: ['manuscript-masthead', 'manuscript-chapters', 'manuscript-paper'],
      signal: ['signal-commandbar', 'signal-rail', 'signal-index'],
    } as const;

    for (const preset of THEME_PRESET_IDS) {
      const classes = expected[preset];
      const themed = {
        ...snapshot,
        project: { ...snapshot.project, config: { theme: { preset }, search: { placeholder: 'ابحث في الدليل' } } },
      } satisfies SiteSnapshot;
      const files = unzipSync(renderStaticHtml(themed, assets).bytes);
      const html = text(required(files['main/ar/intro/index.html']));
      for (const className of classes) expect(html).toContain(className);
      const ownClasses = new Set<string>(classes);
      for (const other of Object.values(expected)
        .flat()
        .filter((className) => !ownClasses.has(className))) {
        expect(html).not.toContain(`class="${other}`);
      }
      expect(html).toContain('dir="rtl"');
      expect(html).toContain('aria-label="ابحث في الدليل"');
    }

    const css = text(required(unzipSync(renderStaticHtml(snapshot, assets).bytes)['theme/theme.css']));
    expect(css).toContain('@media(max-width:760px)');
    expect(css).toContain('border-inline-end');
    expect(css).toContain('[dir="rtl"]');
  });

  it('emits canonical, robots, hreflang, Open Graph, and JSON-LD metadata', () => {
    const bilingual = {
      ...snapshot,
      project: {
        ...snapshot.project,
        languages: [
          ...snapshot.project.languages,
          { code: 'en', label: 'English', direction: 'LTR' as const, isDefault: false, enabled: true, config: null },
        ],
      },
      pages: [
        { ...required(snapshot.pages[0]), translationKey: 'getting-started', content: '# أهلاً\n\n## التثبيت\n\nابدأ هنا.' },
        { ...required(snapshot.pages[1]), translationKey: 'setup' },
        {
          ...required(snapshot.pages[0]),
          id: 'intro-en',
          languageCode: 'en',
          title: 'Introduction',
          translationKey: 'getting-started',
          content: '# Welcome\n\n## Install\n\nStart here.',
        },
      ],
    } satisfies SiteSnapshot;
    const files = unzipSync(renderStaticHtml(bilingual, assets).bytes);
    const html = text(required(files['main/ar/intro/index.html']));

    expect(html).toContain('<link rel="canonical" href="/main/ar/intro/index.html">');
    expect(html).toContain('hreflang="en" href="/main/en/intro/index.html"');
    expect(html).toContain('<meta name="robots" content="index,follow">');
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<link rel="sitemap" type="application/xml" href="/sitemap.xml">');
    expect(html).toContain('href="/main/ar/llms-full.txt"');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"TechArticle"');
    expect(html).toContain('id="التثبيت"');
    expect(html).toContain('href="#التثبيت"');
  });

  it('emits root and language/version-scoped machine-readable discovery files', () => {
    const files = unzipSync(renderStaticHtml(snapshot, assets).bytes);
    const rootIndex = text(required(files['llms.txt']));
    const rootFull = text(required(files['llms-full.txt']));
    const scopedIndex = text(required(files['main/ar/llms.txt']));
    const scopedFull = text(required(files['main/ar/llms-full.txt']));

    expect(text(required(files['robots.txt']))).toBe('User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n');
    expect(text(required(files['sitemap.xml']))).toContain('<loc>/main/ar/intro/index.html</loc>');
    expect(rootIndex).toContain('[مقدمة](main/ar/intro/index.html)');
    expect(scopedIndex).toContain('[مقدمة](intro/index.html)');
    expect(rootFull).toContain('Source: main/ar/intro/index.html');
    expect(scopedFull).toContain('Source: intro/index.html');
    expect(rootFull).not.toContain('globalThis.stolen');
    expect(rootFull).not.toContain('<script>');
  });

  it('drops active MDX and escapes retained authored markup in machine-readable files', () => {
    const page = {
      ...required(snapshot.pages[0]),
      content: `# Safe

Before <ScRiPt src="https://attacker.example/x.js">stolen
<iframe>nested</iframe></sCrIpT> after.

<object data="javascript:run()">object payload</object>
<embed src="https://attacker.example" /> after embed

<custom onclick="run()">Readable</custom>
<svg onload="run()"><a href="javascript:run()">svg link</a></svg>
<math href="javascript:run()">math link</math>

import Exploit from "https://attacker.example/exploit.js"
export const payload = run()
Before expression {globalThis.stolen({ nested: true })} after expression.

<Callout type="tip">**Portable guidance**</Callout>
<RelatedContent title="Continue"><RelatedCard title="Setup" href="/setup" /></RelatedContent>

<STYLE>unclosed style

\`\`\`html
<script onclick="shownAsCode()">const example = { safe: true };</script>
<svg onload="shownAsCode()"></svg>
\`\`\`

~~~mdx
<Callout type="tip">Code sample</Callout>
~~~

&lt;scr<script>ipt&gt;crafted`,
    };
    const files = unzipSync(renderStaticHtml({ ...snapshot, pages: [page] }, assets).bytes);
    const full = text(required(files['llms-full.txt']));

    expect(full).toContain('Before  after.');
    expect(full).toContain('&lt;custom onclick=&quot;run()&quot;&gt;Readable&lt;/custom&gt;');
    expect(full).toContain('&lt;svg onload=&quot;run()&quot;&gt;');
    expect(full).toContain('&lt;math href=&quot;javascript:run()&quot;&gt;math link&lt;/math&gt;');
    expect(full).toContain('&amp;lt;scr');
    expect(full).toContain('&gt; **Portable guidance**');
    expect(full).toContain('## Continue');
    expect(full).toContain('[Setup](/setup)');
    expect(full).toContain('Before expression  after expression.');
    expect(full).toContain(
      '```html\n<script onclick="shownAsCode()">const example = { safe: true };</script>\n<svg onload="shownAsCode()"></svg>\n```',
    );
    expect(full).toContain('~~~mdx\n<Callout type="tip">Code sample</Callout>\n~~~');
    expect(full).not.toMatch(/stolen|nested|object payload|unclosed style|crafted|Exploit|payload = run/);
    const prose = full.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '');
    expect(prose).not.toMatch(/<\/?(?:script|style|iframe|object|embed|svg|math)\b/i);
    expect(prose).not.toMatch(/<[a-z][^>]*\son(?:click|load)\s*=/i);
  });

  it('keeps private, noindex, and externally canonicalized pages out of discovery files', () => {
    const restrictedPages = [
      { ...required(snapshot.pages[0]), config: { seo: { noindex: true } } },
      { ...required(snapshot.pages[1]), config: { seo: { canonicalUrl: 'https://example.com/setup' } } },
    ];
    const files = unzipSync(renderStaticHtml({ ...snapshot, pages: restrictedPages }, assets).bytes);
    expect(text(required(files['sitemap.xml']))).not.toContain('<url>');
    expect(text(required(files['llms.txt']))).not.toContain('[مقدمة]');
    expect(text(required(files['main/ar/intro/index.html']))).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(text(required(files['main/ar/setup/index.html']))).toContain('<link rel="canonical" href="https://example.com/setup">');

    const privateFiles = unzipSync(
      renderStaticHtml({ ...snapshot, project: { ...snapshot.project, config: { visibility: 'private' } } }, assets).bytes,
    );
    expect(text(required(privateFiles['robots.txt']))).toBe('User-agent: *\nDisallow: /\n');
    expect(text(required(privateFiles['llms-full.txt']))).toBe('');
  });

  it('does not execute raw published HTML in static archives', () => {
    const html = renderPageMarkdown(snapshot, required(snapshot.pages[0]), assets);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders supported authored Callout Markdown while keeping unknown HTML inert', () => {
    const page = {
      ...required(snapshot.pages[0]),
      content:
        '<Callout type="tip">\n\n**Portable callout** with [guidance](/setup).\n\n</Callout>\n\nReadable <Tooltip tip="Auth token">credential</Tooltip> <Icon icon="star" />.\n\n<Unknown onclick="alert(1)">unsafe</Unknown>',
    };
    const html = renderPageMarkdown(snapshot, page, assets);

    expect(html).toContain('<blockquote>');
    expect(html).toContain('<strong>Portable callout</strong>');
    expect(html).toContain('href="../setup/index.html"');
    expect(html).toContain('Readable credential');
    expect(html).not.toContain('<Icon');
    expect(html).toContain('&lt;Unknown onclick=&quot;alert(1)&quot;&gt;unsafe&lt;/Unknown&gt;');
    expect(html).not.toContain('<Unknown onclick=');
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

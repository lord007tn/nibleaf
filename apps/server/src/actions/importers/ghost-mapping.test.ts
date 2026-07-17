import { describe, expect, it } from 'vitest';
import {
  byPublishedAt,
  convertGhostHtml,
  GhostExportError,
  ghostImportSourceUrl,
  ghostItemSlug,
  ghostItemToMarkdown,
  htmlToPlainText,
  isGhostPlaceholder,
  parseGhostExport,
  resolveGhostLanguage,
} from './ghost-mapping';

const post = (over: Record<string, unknown>) => ({
  title: 'Hello world',
  slug: 'hello-world',
  html: '<p>Hi</p>',
  status: 'published',
  ...over,
});

/** Full Ghost export document (`ghost-export.json` shape). */
const fullExport = {
  db: [
    {
      meta: { exported_on: 1721000000000, version: '5.82.0' },
      data: {
        posts: [
          post({ id: 'post-1', slug: 'first', published_at: '2024-01-01T00:00:00.000Z' }),
          post({ slug: 'draft', status: 'draft' }),
          post({ slug: 'about', type: 'page', published_at: '2024-02-01T00:00:00.000Z' }),
          post({ slug: 'legacy-page', page: 1 }),
        ],
        tags: [
          { id: 'tag-news', name: 'News', slug: 'news' },
          { id: 'tag-en', name: 'English', slug: 'en' },
        ],
        posts_tags: [
          { post_id: 'post-1', tag_id: 'tag-news' },
          { post_id: 'post-1', tag_id: 'tag-en' },
        ],
        users: [{ name: 'author' }],
      },
    },
  ],
};

describe('parseGhostExport', () => {
  it('reads db[0].data, keeps only published items, and splits posts from pages', () => {
    const { posts, pages } = parseGhostExport(fullExport);
    expect(posts.map((p) => p.slug)).toEqual(['first']);
    expect(posts[0]?.tags).toEqual(['news', 'en']);
    expect(pages.map((p) => p.slug)).toEqual(['about', 'legacy-page']);
  });

  it('accepts the bare inner document and a separate pages collection', () => {
    const { posts, pages } = parseGhostExport({
      data: { posts: [post({ slug: 'a' })], pages: [post({ slug: 'standalone-page' })] },
    });
    expect(posts.map((p) => p.slug)).toEqual(['a']);
    expect(pages.map((p) => p.slug)).toEqual(['standalone-page']);
  });

  it('rejects documents that are not Ghost exports', () => {
    expect(() => parseGhostExport(null)).toThrow(GhostExportError);
    expect(() => parseGhostExport({ hello: 'world' })).toThrow(GhostExportError);
    expect(() => parseGhostExport({ db: [{ data: { posts: 'nope' } }] })).toThrow(GhostExportError);
    expect(() => parseGhostExport({ db: [{ data: { posts: [] } }] })).toThrow(GhostExportError);
  });

  it('extracts excerpt and feature image fields', () => {
    const { posts } = parseGhostExport({
      data: { posts: [post({ custom_excerpt: 'The summary', feature_image: '/content/images/x.png' })] },
    });
    expect(posts[0]?.description).toBe('The summary');
    expect(posts[0]?.featureImage).toBe('/content/images/x.png');
  });
});

describe('ghostImportSourceUrl', () => {
  it('reads and normalizes the dashboard metadata without trusting credentials or non-http schemes', () => {
    expect(ghostImportSourceUrl({ __nibleafImport: { ghostUrl: 'https://ghost.example.com/some/path' } })).toBe('https://ghost.example.com');
    expect(ghostImportSourceUrl({ __nibleafImport: { ghostUrl: 'file:///tmp/ghost' } })).toBeUndefined();
    expect(ghostImportSourceUrl({ __nibleafImport: { ghostUrl: 'https://user:secret@example.com' } })).toBeUndefined();
  });
});

describe('resolveGhostLanguage', () => {
  const item = (tags: string[], title = 'English title') => ({ tags, title, plaintext: null, html: null });

  it('uses an exact language tag and supports a base tag for one regional locale', () => {
    expect(resolveGhostLanguage(item(['news', 'ar']), ['en', 'ar'], 'en')).toEqual({ code: 'ar', reason: 'tag' });
    expect(resolveGhostLanguage(item(['pt']), ['en', 'pt-BR'], 'en')).toEqual({ code: 'pt-BR', reason: 'tag' });
  });

  it('uses Arabic script to disambiguate items carrying both ar and en tags', () => {
    expect(resolveGhostLanguage(item(['ar', 'en'], 'إدارة الحجوزات'), ['en', 'ar'], 'en')).toEqual({ code: 'ar', reason: 'ambiguous-tags' });
    expect(resolveGhostLanguage(item(['ar', 'en']), ['en', 'ar'], 'en')).toEqual({ code: 'en', reason: 'ambiguous-tags' });
  });

  it('falls back to the project default when no configured language tag exists', () => {
    expect(resolveGhostLanguage(item(['news']), ['en', 'ar'], 'en')).toEqual({ code: 'en', reason: 'default' });
  });
});

describe('ghostItemSlug', () => {
  it('keeps Latin slugs verbatim without a fallback', () => {
    expect(ghostItemSlug({ slug: 'hello-world', title: 'Hello' }, 0)).toEqual({ slug: 'hello-world', usedHashFallback: false });
    expect(ghostItemSlug({ slug: '', title: 'From Title' }, 0)).toEqual({ slug: 'from-title', usedHashFallback: false });
  });

  it('gives two Arabic posts distinct, stable hash slugs instead of one shared literal', () => {
    const first = ghostItemSlug({ slug: 'مرحبا-بالعالم', title: 'مرحبا بالعالم' }, 0);
    const second = ghostItemSlug({ slug: 'مقالة-ثانية', title: 'مقالة ثانية' }, 1);
    expect(first.usedHashFallback).toBe(true);
    expect(second.usedHashFallback).toBe(true);
    expect(first.slug).toMatch(/^post-[0-9a-f]{8}$/);
    expect(second.slug).toMatch(/^post-[0-9a-f]{8}$/);
    expect(first.slug).not.toBe(second.slug);
    // Re-import determinism: the hash depends on the item's slug, not its position.
    expect(ghostItemSlug({ slug: 'مرحبا-بالعالم', title: 'مرحبا بالعالم' }, 7).slug).toBe(first.slug);
  });
});

describe('byPublishedAt', () => {
  it('orders oldest first, undated entries last', () => {
    const items = [
      { publishedAt: '2024-03-01T00:00:00.000Z' as string | null, slug: 'c' },
      { publishedAt: null, slug: 'undated' },
      { publishedAt: '2024-01-01T00:00:00.000Z', slug: 'a' },
    ].map((over) => ({ id: '', tags: [], title: '', html: null, plaintext: null, status: null, featureImage: null, description: null, ...over }));
    expect([...items].sort(byPublishedAt).map((i) => i.slug)).toEqual(['a', 'c', 'undated']);
  });
});

describe('isGhostPlaceholder', () => {
  it('recognizes the stock Ghost Coming soon post without hiding a real similarly titled article', () => {
    expect(
      isGhostPlaceholder({
        title: 'Coming soon',
        slug: 'coming-soon',
        plaintext: "This is Acme, a brand new site that's just getting started. Things will be up and running here shortly.",
      }),
    ).toBe(true);
    expect(isGhostPlaceholder({ title: 'Coming soon', slug: 'coming-soon', plaintext: 'A real product launch announcement.' })).toBe(false);
  });
});

describe('convertGhostHtml', () => {
  it('converts headings, emphasis, code blocks, images, and tables to Markdown', () => {
    const html = [
      '<h2>Title</h2>',
      '<p>Some <strong>bold</strong> and <em>italic</em> text.</p>',
      '<pre><code class="language-js">const x = 1;</code></pre>',
      '<figure><img src="/content/images/pic.png" alt="A pic"><figcaption>Caption</figcaption></figure>',
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    ].join('');
    const { markdown, usedFallback } = convertGhostHtml(html);
    expect(usedFallback).toBe(false);
    expect(markdown).toContain('## Title');
    expect(markdown).toContain('**bold**');
    expect(markdown).toContain('_italic_');
    expect(markdown).toContain('```js\nconst x = 1;\n```');
    expect(markdown).toContain('![A pic](/content/images/pic.png)');
    expect(markdown).toContain('| A | B |');
    expect(markdown).toContain('| 1 | 2 |');
  });

  it('rewrites __GHOST_URL__ placeholders to relative URLs and flags them', () => {
    const { markdown, hadGhostUrls } = convertGhostHtml('<img src="__GHOST_URL__/content/images/a.png" alt="a">');
    expect(hadGhostUrls).toBe(true);
    expect(markdown).toBe('![a](/content/images/a.png)');
  });

  it('resolves __GHOST_URL__ placeholders against the source publication when provided', () => {
    const { markdown, hadGhostUrls } = convertGhostHtml('<img src="__GHOST_URL__/content/images/a.png" alt="a">', 'https://ghost.example.com');
    expect(hadGhostUrls).toBe(true);
    expect(markdown).toBe('![a](https://ghost.example.com/content/images/a.png)');
  });

  it('preserves legacy help-site links exactly', () => {
    const { markdown } = convertGhostHtml('<p><a href="http://help.joodbooking.com/en/getting-started/">Return to setup</a></p>');
    expect(markdown).toBe('[Return to setup](http://help.joodbooking.com/en/getting-started/)');
  });
});

describe('htmlToPlainText (conversion fallback)', () => {
  it('strips tags, scripts, and entities into readable text', () => {
    const text = htmlToPlainText('<script>evil()</script><h1>Header</h1><p>Line &amp; one</p><p>Line two</p>');
    expect(text).not.toContain('evil');
    expect(text).toContain('Header');
    expect(text).toContain('Line & one');
    expect(text).toContain('Line two');
  });
});

describe('ghostItemToMarkdown', () => {
  const base = {
    id: 'post',
    tags: [],
    title: 'Post',
    slug: 'post',
    plaintext: null,
    status: 'published',
    featureImage: null,
    description: null,
    publishedAt: null,
  };

  it('prepends the feature image as a leading Markdown image', () => {
    const { markdown } = ghostItemToMarkdown({ ...base, html: '<p>Body</p>', featureImage: '__GHOST_URL__/content/images/hero.png' });
    expect(markdown).toBe('![Post](/content/images/hero.png)\n\nBody');
  });

  it('resolves feature-image placeholders using the source publication URL', () => {
    const { markdown } = ghostItemToMarkdown(
      { ...base, html: '<p>Body</p>', featureImage: '__GHOST_URL__/content/images/hero.png' },
      'https://ghost.example.com',
    );
    expect(markdown).toBe('![Post](https://ghost.example.com/content/images/hero.png)\n\nBody');
  });

  it('falls back to plaintext when there is no html', () => {
    const { markdown, usedFallback } = ghostItemToMarkdown({ ...base, html: null, plaintext: 'Just text' });
    expect(markdown).toBe('Just text');
    expect(usedFallback).toBe(false);
  });
});

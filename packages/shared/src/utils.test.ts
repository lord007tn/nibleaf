import { describe, expect, it } from 'vitest';
import { excerpt, joinPath, plural, slugify, slugifyUnicode, stripMarkdownLinks } from './utils';

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('Getting Started!')).toBe('getting-started');
    expect(slugify('  Hello   World  ')).toBe('hello-world');
  });
  it('trims leading/trailing dashes and handles empty results', () => {
    expect(slugify('--Foo--')).toBe('foo');
    expect(slugify('@@@')).toBe('');
  });
  it('handles long separator runs without regex backtracking', () => {
    expect(slugify(`start${'-'.repeat(100_000)}end`)).toBe('start-end');
  });
  it('stays ASCII-only by default so hostnames and storage keys are unaffected', () => {
    expect(slugify('المصادقة')).toBe('');
    expect(slugify('API الوصول')).toBe('api');
    expect(slugify('Café au lait')).toBe('caf-au-lait');
  });
  it('caps the slug length at a dash boundary', () => {
    expect(slugify(`${'a'.repeat(199)} ${'b'.repeat(50)}`)).toBe('a'.repeat(199));
    expect(slugify('x'.repeat(500))).toHaveLength(200);
  });
});

describe('slugifyUnicode', () => {
  it('keeps Latin behaviour identical to slugify', () => {
    for (const input of ['Getting Started!', '  Hello   World  ', '--Foo--', '@@@', 'v1.0.0 (beta)', 'API Reference']) {
      expect(slugifyUnicode(input)).toBe(slugify(input));
    }
  });
  it('turns an Arabic title into an Arabic slug', () => {
    expect(slugifyUnicode('المصادقة')).toBe('المصادقة');
    expect(slugifyUnicode('  الدليل  السريع ')).toBe('الدليل-السريع');
  });
  it('keeps mixed Arabic and Latin words, lowercasing the Latin part', () => {
    expect(slugifyUnicode('API الوصول')).toBe('api-الوصول');
    expect(slugifyUnicode('مفاتيح API v2')).toBe('مفاتيح-api-v2');
  });
  it('strips Arabic diacritics and tatweel so vocalised and plain titles share a slug', () => {
    expect(slugifyUnicode('اَلْمُصَادَقَة')).toBe('المصادقة');
    expect(slugifyUnicode('المصـــادقة')).toBe('المصادقة');
    expect(slugifyUnicode('كلمةٌ ثانيةً')).toBe('كلمة-ثانية');
  });
  it('drops zero-width joiners without splitting the word', () => {
    expect(slugifyUnicode('می\u200cخواهم')).toBe('میخواهم');
  });
  it('handles Hebrew, Cyrillic, CJK, and Indic scripts (combining vowel signs kept)', () => {
    expect(slugifyUnicode('שלום עולם')).toBe('שלום-עולם');
    expect(slugifyUnicode('בְּרֵאשִׁית')).toBe('בראשית');
    expect(slugifyUnicode('Начало работы')).toBe('начало-работы');
    expect(slugifyUnicode('快速入门')).toBe('快速入门');
    expect(slugifyUnicode('हिन्दी में शुरू करें')).toBe('हिन्दी-में-शुरू-करें');
    expect(slugifyUnicode('Français: Démarrage')).toBe('français-démarrage');
  });
  it('returns an empty slug for emoji-only or punctuation-only titles so callers fall back', () => {
    expect(slugifyUnicode('🚀🎉')).toBe('');
    expect(slugifyUnicode('👨‍👩‍👧')).toBe('');
    expect(slugifyUnicode('...')).toBe('');
    expect(slugifyUnicode('🚀 إطلاق')).toBe('إطلاق');
  });
  it('strips dots, slashes, and other path characters', () => {
    expect(slugifyUnicode('../الإعدادات/الأمان.mdx')).toBe('الإعدادات-الأمان-mdx');
    expect(slugifyUnicode('a/b\\c?d#e%f')).toBe('a-b-c-d-e-f');
  });
  it('is deterministic and idempotent', () => {
    for (const input of ['اَلْمُصَادَقَة', 'API الوصول', 'Getting Started!', 'שלום עולם', 'हिन्दी में']) {
      const once = slugifyUnicode(input);
      expect(slugifyUnicode(once)).toBe(once);
      expect(slugifyUnicode(input)).toBe(once);
    }
  });
  it('normalises decomposed input so NFC and NFD titles share a slug', () => {
    expect(slugifyUnicode('cafe\u0301')).toBe(slugifyUnicode('café'));
  });
  it('caps the slug length', () => {
    expect(slugifyUnicode('م'.repeat(500))).toHaveLength(200);
  });
});

describe('joinPath', () => {
  it('returns the slug when there is no parent', () => {
    expect(joinPath(null, 'intro')).toBe('intro');
    expect(joinPath('', 'intro')).toBe('intro');
    expect(joinPath(undefined, 'intro')).toBe('intro');
  });
  it('joins parent and slug, trimming surrounding slashes', () => {
    expect(joinPath('guides', 'intro')).toBe('guides/intro');
    expect(joinPath('/guides/', 'intro')).toBe('guides/intro');
  });
  it('trims long slash runs in linear time', () => {
    expect(joinPath(`${'/'.repeat(100_000)}guides${'/'.repeat(100_000)}`, 'intro')).toBe('guides/intro');
  });
});

describe('stripMarkdownLinks', () => {
  it('keeps link labels and removes images', () => {
    expect(stripMarkdownLinks('Read [the guide](/guide) ![logo](/logo.png).')).toBe('Read the guide .');
  });
  it('preserves malformed markup and handles long labels', () => {
    const label = 'x'.repeat(100_000);
    expect(stripMarkdownLinks(`[${label}](/x)`)).toBe(label);
    expect(stripMarkdownLinks('[unfinished')).toBe('[unfinished');
  });
});

describe('excerpt', () => {
  it('strips fenced code, links, and markdown punctuation', () => {
    const md = '# Title\n\nSee [the docs](https://x) for `code`.\n\n```js\nconst a = 1;\n```';
    const out = excerpt(md);
    expect(out).not.toContain('```');
    expect(out).not.toContain('const a = 1');
    expect(out).toContain('the docs');
    expect(out).not.toContain('https://x');
  });
  it('removes Markdown images instead of leaking image syntax or URLs', () => {
    const out = excerpt('Add the company settings\n\n![](https://ghost.example.com/content/images/steps.jpg)\n\nThen continue.');
    expect(out).toBe('Add the company settings Then continue.');
  });
  it('truncates past the max with an ellipsis', () => {
    const out = excerpt('a '.repeat(200), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('plural', () => {
  it('omits the suffix only for a count of one', () => {
    expect(plural(1, 'page')).toBe('1 page');
    expect(plural(2, 'page')).toBe('2 pages');
    expect(plural(0, 'site')).toBe('0 sites');
  });
});

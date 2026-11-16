import { describe, expect, it } from 'vitest';
import { chunkSearchDocument, cleanSearchText, createDocIndex, type SearchDoc, searchChunkSnippet, searchDocs } from './index';

const doc = (content: string): SearchDoc => ({ id: 'page', title: 'Guide', path: 'guide', headings: 'Settings', description: '', content });

describe('plain search snippets', () => {
  it.each([
    [
      'english',
      'Setting · Default · Purpose SITE_BASE_DOMAIN · Empty · Custom domain',
      '| Setting | Default | Purpose |\n| :--- | :---: | ---: |\n| SITE_BASE_DOMAIN | Empty | Custom domain |',
      'domain',
    ],
    [
      'arabic',
      'الإعداد · الافتراضي · الغرض نطاق · فارغ · نطاق مخصص',
      '| الإعداد | الافتراضي | الغرض |\n| :--- | :---: | ---: |\n| نطاق | فارغ | نطاق مخصص |',
      'نطاق',
    ],
  ] as const)('cleans a %s table section and keeps its words searchable', async (language, expected, table, query) => {
    const content = `## Settings\n\n${table}`;
    expect(cleanSearchText(table)).toBe(expected);
    const index = await createDocIndex([doc(content)], language);
    for (const options of [{}, { relevance: 'reader' as const }]) {
      const [hit] = await searchDocs(index, query, options);
      expect(hit?.snippet).toBe(`Settings ${expected}`);
    }
    const [chunk] = chunkSearchDocument(
      { projectId: 'site', deploymentId: 'published', versionSlug: 'main' },
      {
        ...doc(table),
        headings: [],
        language: language === 'arabic' ? 'ar' : 'en',
        visible: true,
      },
    );
    if (!chunk) throw new Error('missing table chunk');
    // Existing stored chunks retain raw Markdown; cleaning happens on read.
    expect(chunk.content).toBe(table);
    expect(searchChunkSnippet(chunk, query)).toBe(expected);
  });

  it.each([
    ['**Publish** *changes*, __carefully__ and _safely_.', 'Publish changes, carefully and safely.', ['Publish', 'carefully', 'safely']],
    ['[Publish changes](/publish) with `SITE_BASE_DOMAIN`.', 'Publish changes with SITE_BASE_DOMAIN.', ['Publish', 'SITE_BASE_DOMAIN']],
    ['  # Publish ##\n  - changes\n2) safely', 'Publish changes safely', ['Publish', 'changes', 'safely']],
    ['<Callout><strong>Publish</strong> changes</Callout>', 'Publish changes', ['Publish', 'changes']],
    ['$energy$ and $$mass$$', 'energy and mass', ['energy', 'mass']],
    ['$$\nenergy = mass\n$$', 'energy = mass', ['energy', 'mass']],
    ['**انشر** _التغييرات_، [بأمان](/ar).', 'انشر التغييرات، بأمان.', ['انشر', 'التغييرات', 'بأمان']],
  ] as const)('removes prose markup: %s', async (content, expected, words) => {
    expect(cleanSearchText(content)).toBe(expected);
    const index = await createDocIndex([doc(content)], content.includes('انشر') ? 'arabic' : 'english');
    for (const word of words) {
      const [hit] = await searchDocs(index, word, { relevance: 'reader' });
      expect(hit?.id, word).toBe('page');
      expect(hit?.snippet, word).toBe(expected);
    }
  });

  it.each(['keyword', 'stored-chunk'] as const)('preserves an escaped terminal pipe in a borderless table through the %s path', async (path) => {
    const content = 'Name | Symbol\n--- | ---\nmode | left \\|';
    const expected = 'Name · Symbol mode · left |';
    if (path === 'keyword') {
      const index = await createDocIndex([doc(content)], 'english');
      const [hit] = await searchDocs(index, 'mode', { relevance: 'reader' });
      expect(hit?.snippet).toBe(expected);
    } else {
      const [chunk] = chunkSearchDocument(
        { projectId: 'site', deploymentId: 'published', versionSlug: 'main' },
        { ...doc(content), headings: [], language: 'en', visible: true },
      );
      if (!chunk) throw new Error('missing table chunk');
      expect(searchChunkSnippet(chunk, 'mode')).toBe(expected);
    }
  });

  it('preserves literal code, identifiers and non-table pipes', () => {
    expect(cleanSearchText('`Map<T>` and SITE_BASE_DOMAIN and a | b')).toBe('Map<T> and SITE_BASE_DOMAIN and a | b');
    expect(cleanSearchText('| Code | Label |\n| --- | --- |\n| `a|b` | Left \\| right |')).toBe('Code · Label a|b · Left | right');
    expect(cleanSearchText('| SITE_BASE_DOMAIN | Custom domain |')).toBe('SITE_BASE_DOMAIN · Custom domain');
    expect(cleanSearchText('Name | Purpose\n:--- | ---:\nDomain | Site address')).toBe('Name · Purpose Domain · Site address');
    expect(cleanSearchText('Cost $5 and $10. Use `$energy$` or \\$amount.')).toBe('Cost $5 and $10. Use $energy$ or \\$amount.');
  });
});

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

  const tableEdges = [
    ['table on a bullet opening line', '- | Name | Symbol |\n  | --- | --- |\n  | mode | value |', 'Name · Symbol mode · value', 'mode'],
    ['table on an ordered list opening line', '1. | Name | Symbol |\n   | --- | --- |\n   | mode | value |', 'Name · Symbol mode · value', 'mode'],
    [
      'table in a list continuation',
      '- Settings\n\n  | Name | Symbol |\n  | --- | --- |\n  | mode | value |\n\n- Save',
      'Settings Name · Symbol mode · value Save',
      'mode',
    ],
    [
      'nested list table',
      '1. Settings\n   - Values\n\n     Name | Symbol\n     --- | ---\n     mode | value',
      'Settings Values Name · Symbol mode · value',
      'mode',
    ],
    ['mixed Arabic and English', '| Name | الإعداد |\n| --- | --- |\n| mode | نطاق آمن |', 'Name · الإعداد mode · نطاق آمن', 'نطاق'],
    ['no outer borders', 'Name | Symbol\n--- | ---\nmode | value', 'Name · Symbol mode · value', 'mode'],
    ['only leading borders', '| Name | Symbol\n| --- | ---\n| mode | value', 'Name · Symbol mode · value', 'mode'],
    ['only trailing borders', 'Name | Symbol |\n--- | --- |\nmode | value |', 'Name · Symbol mode · value', 'mode'],
    [
      'leading escaped pipe',
      String.raw`\| a | b
--- | ---
mode | value`,
      '| a · b mode · value',
      'mode',
    ],
    [
      'two backslashes before a border',
      String.raw`Name | Symbol
--- | ---
mode \\| value`,
      String.raw`Name · Symbol mode \\ · value`,
      'mode',
    ],
    [
      'three backslashes before a literal pipe',
      String.raw`Name | Symbol
--- | ---
mode | left \\\| right`,
      String.raw`Name · Symbol mode · left \\| right`,
      'mode',
    ],
    [
      'four backslashes before a border',
      String.raw`Name | Symbol
--- | ---
mode \\\\| value`,
      String.raw`Name · Symbol mode \\\\ · value`,
      'mode',
    ],
    ['empty edge cells', '| Left | Center | Right |\n| --- | --- | --- |\n| | mode | |', 'Left · Center · Right · mode ·', 'mode'],
    ['pipe-only row', '| Name | Symbol |\n| --- | --- |\n|||\n| mode | value |', 'Name · Symbol · mode · value', 'mode'],
    ['pipe-only cells', '| Name | Symbol |\n| --- | --- |\n| mode | \\| |\n| `|` | \\| |', 'Name · Symbol mode · | | · |', 'mode'],
    ['stored table fragment without a header', '| mode | نطاق |', 'mode · نطاق', 'نطاق'],
    [
      'whitespace and CRLF Arabic rows',
      ' \t| الاسم \t| Symbol | \r\n | :--- | ---: |\r\n \t| نطاق \t| mode | \r\n',
      'الاسم · Symbol نطاق · mode',
      'نطاق',
    ],
  ] as const;

  for (const path of ['keyword', 'reader-keyword', 'stored-chunk'] as const) {
    it.each(tableEdges)(`cleans %s through the ${path} path`, async (_name, content, expected, query) => {
      expect(cleanSearchText(content)).toBe(expected);
      if (path === 'stored-chunk') {
        const [chunk] = chunkSearchDocument(
          { projectId: 'site', deploymentId: 'published', versionSlug: 'main' },
          { ...doc(content), headings: [], language: 'ar', visible: true },
        );
        if (!chunk) throw new Error('missing table chunk');
        expect(chunk.content).toBe(content.replace(/\r\n/g, '\n').trim());
        // Persisted chunks may predate the chunker's newline normalization.
        expect(searchChunkSnippet({ ...chunk, content }, query)).toBe(expected);
      } else {
        const index = await createDocIndex([doc(content)], query === 'نطاق' ? 'arabic' : 'english');
        const [hit] = await searchDocs(index, query, path === 'reader-keyword' ? { relevance: 'reader' } : {});
        expect(hit?.id).toBe('page');
        expect(hit?.snippet).toBe(expected);
      }
    });
  }
});

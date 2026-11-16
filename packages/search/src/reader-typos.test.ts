import { describe, expect, it } from 'vitest';
import { createDocIndex, type SearchDoc, searchDocs } from './index';

const doc = (id: string, title: string, content = ''): SearchDoc => ({ id, title, path: id, content, headings: '', description: '' });
const reader = { relevance: 'reader' as const };

describe('reader one-letter typos', () => {
  it.each(['publsh', 'publixh', 'publiish'])('finds Publish your changes for %s', async (query) => {
    const index = await createDocIndex([doc('publish', 'Publish your changes', 'Publish your changes from the dashboard.')]);
    expect((await searchDocs(index, query, reader)).map((hit) => hit.id)).toEqual(['publish']);
  });

  it('covers a multiword typo query in body text without accepting a partial tail', async () => {
    const index = await createDocIndex([doc('publish', 'Guide', 'Publish your changes.'), doc('tail', 'Manual', 'Review the changes.')]);
    expect((await searchDocs(index, 'publsh changes', reader)).map((hit) => hit.id)).toEqual(['publish']);
  });

  it('keeps exact and prefix hits ahead of typo-only title hits, including scores', async () => {
    const index = await createDocIndex([
      doc('typo', 'Publizh'),
      doc('prefix', 'Publishing'),
      doc('body', 'Manual', 'Publish your changes.'),
      doc('exact', 'Publish'),
    ]);
    const hits = await searchDocs(index, 'publish', reader);
    expect(hits.map((hit) => hit.id)).toEqual(['exact', 'prefix', 'body', 'typo']);
    expect(hits[3]?.score).toBeLessThan(hits[2]?.score ?? 0);
    expect((await searchDocs(index, 'publish', { ...reader, limit: 1 })).map((hit) => hit.id)).toEqual(['exact']);
  });

  it('does not fuzz short words, even alongside a longer typo', async () => {
    const index = await createDocIndex([doc('api', 'API'), doc('other', 'Manual', 'Publish acne.')]);
    expect(await searchDocs(index, 'appi', reader)).toEqual([]);
    expect(await searchDocs(index, 'publsh acme', reader)).toEqual([]);
  });

  it('requires every typo-query word and refuses two edits', async () => {
    const index = await createDocIndex([doc('publish', 'Publish your changes')]);
    expect(await searchDocs(index, 'pubsh', reader)).toEqual([]);
    expect(await searchDocs(index, 'publsh nonsense', reader)).toEqual([]);
    expect(await searchDocs(index, 'publsh', { ...reader, tolerance: 0 })).toEqual([]);
  });

  it('keeps the lexical relevance floor for weak prefix matches', async () => {
    const index = await createDocIndex([doc('exact', 'Invoice'), doc('body', 'Manual', 'Invoice'), doc('weak', 'Exports', 'Invoices')]);
    expect((await searchDocs(index, 'invoice', reader)).map((hit) => hit.id)).toEqual(['exact', 'body']);
  });

  it('recovers an Arabic typo and preserves Arabic text and existing morphology', async () => {
    const body = 'إدارة المستخدمين بأمان من لوحة التحكم.';
    const index = await createDocIndex([doc('users', 'المستخدمين', body)], 'arabic');
    for (const query of ['المستحدمين', 'المستخدمين', 'مستخدم']) {
      const [hit] = await searchDocs(index, query, reader);
      expect(hit?.id, query).toBe('users');
      expect(hit?.snippet, query).toBe(body);
    }
  });
});

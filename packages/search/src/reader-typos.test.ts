import { describe, expect, it } from 'vitest';
import { createDocIndex, type SearchDoc, searchDocs } from './index';
import { readerSearchFields, readerSearchTerms, readerTypoRelevanceScore } from './reader-relevance';

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

  /**
   * #831: the 5-letter threshold and the one-edit check count letters (code points) of the normalized, stemmed
   * terms, not UTF-16 units. The relevance gate is checked directly: retrieval may return the candidate or not
   * (Orama's own tolerance), but the gate must never pass a typo the rule refuses.
   */
  describe('the 5-letter threshold, in letters', () => {
    const typoScore = (title: string, query: string, language?: 'arabic') =>
      readerTypoRelevanceScore(
        readerSearchTerms(query, language),
        readerSearchFields({ title, headings: '', description: '', content: '' }, language),
      );
    const letters = (word: string, language?: 'arabic') => [...readerSearchTerms(word, language)].map((term) => [...term].length);

    it.each([
      // CJK runs are one term: four characters stay exact, five may take one edit.
      ['CJK, 4 characters', '发布流程', '发表流程', 4, false],
      ['CJK, 5 characters', '文档发布流程', '文档发表流程', 6, true],
      // Characters outside the Basic Multilingual Plane are two UTF-16 units each.
      ['astral, 3 letters (6 units)', '𠀀𠀁𠀂', '𠀀𠀁𠀃', 3, false],
      ['astral, 4 letters (8 units)', '𠀀𠀁𠀂𠀃', '𠀀𠀁𠀂𠀅', 4, false],
      ['astral, 5 letters (10 units)', '𠀀𠀁𠀂𠀃𠀄', '𠀀𠀁𠀂𠀃𠀅', 5, true],
      ['astral, 5 letters, one deleted', '𠀀𠀁𠀂𠀃𠀄', '𠀀𠀁𠀂𠀄', 4, false],
      ['astral, 6 letters, one deleted', '𠀀𠀁𠀂𠀃𠀄𠀅', '𠀀𠀁𠀂𠀄𠀅', 5, true],
      ['astral, 5 letters, one inserted', '𠀀𠀁𠀂𠀃𠀄', '𠀀𠀁𠀂𠀆𠀃𠀄', 6, true],
      ['astral, 5 letters, two replaced', '𠀀𠀁𠀂𠀃𠀄', '𠀀𠀁𠀇𠀃𠀅', 5, false],
      ['mixed astral and Latin, 5 letters', 'ab𠀀cd', 'ab𠀁cd', 5, true],
    ] as const)('%s', (_name, title, query, queryLetters, accepted) => {
      expect(letters(query)).toEqual([queryLetters]);
      expect(typoScore(title, query) > 0).toBe(accepted);
    });

    it('counts Arabic letters after normalization and light stemming', () => {
      // Five letters after stemming: one substitution is a typo.
      expect(letters('برنامح', 'arabic')).toEqual([6]);
      expect(typoScore('برنامج', 'برنامح', 'arabic')).toBeGreaterThan(0);
      expect(letters('تطبيك', 'arabic')).toEqual([5]);
      expect(typoScore('تطبيق', 'تطبيك', 'arabic')).toBeGreaterThan(0);
      // Four letters: exact only, even when the typed word was longer before its suffix was stemmed off.
      expect(letters('مكتت', 'arabic')).toEqual([4]);
      expect(typoScore('مكتب', 'مكتت', 'arabic')).toBe(0);
      expect(letters('مكتتة', 'arabic')).toEqual([4]);
      expect(typoScore('مكتبة', 'مكتتة', 'arabic')).toBe(0);
    });
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

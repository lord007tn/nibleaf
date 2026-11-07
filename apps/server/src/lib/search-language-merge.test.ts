import { createDocIndex, oramaLanguageForCode, type SearchDoc, searchDocs, stripMarkdown } from '@nibleaf/search';
import { describe, expect, it } from 'vitest';
import { mergeLanguageSearchHits } from './search-language-merge';

const doc = (id: string, title: string, markdown: string): SearchDoc => ({
  id,
  title,
  path: id,
  description: '',
  headings: '',
  content: stripMarkdown(markdown),
});

// An English site and its Arabic translation. The Arabic export page mentions
// "export" and "notebook" only inside CLI code spans.
const english = [
  doc('en-export', 'Export your notes', 'Export a notebook to Markdown. Choose a notebook, then export it, or run `acme export --notebook <name>`.'),
  doc('en-sync', 'Sync across devices', 'Notes sync in the background. You can export a copy at any time from Settings.'),
  doc('en-backup', 'Back up a workspace', 'Back up every notebook nightly. Restores read the same files that export writes.'),
  doc('en-share', 'Share a notebook', 'Invite people to a notebook. Shared notebooks export with their comments.'),
  doc('en-start', 'Get started', 'Create your first notebook and write a note.'),
];
const arabic = [
  doc('ar-export', 'تصدير ملاحظاتك', 'صدّر دفترًا إلى Markdown. نفّذ `acme export --format markdown --out ./backup` أو `--notebook <name>`.'),
  doc('ar-sync', 'المزامنة بين الأجهزة', 'تُزامَن الملاحظات في الخلفية، ويمكنك نسخها في أي وقت من الإعدادات.'),
  doc('ar-backup', 'النسخ الاحتياطي لمساحة العمل', 'انسخ كل دفتر احتياطيًا كل ليلة.'),
  doc('ar-start', 'ابدأ الآن', 'أنشئ دفترك الأول واكتب ملاحظة.'),
];

const search = async (query: string) => {
  const [en, ar] = await Promise.all([createDocIndex(english, oramaLanguageForCode('en')), createDocIndex(arabic, oramaLanguageForCode('ar'))]);
  const [enHits, arHits] = await Promise.all([searchDocs(en, query, { limit: 10 }), searchDocs(ar, query, { limit: 10 })]);
  return [
    { language: 'en', result: { hits: enHits } },
    { language: 'ar', result: { hits: arHits } },
  ];
};

describe('merging multilingual search results', () => {
  it.each(['export', 'notebook'])('ranks the exact English page above the Arabic translation for "%s" on an English reader', async (query) => {
    const perLanguage = await search(query);
    // Raw scores from separate indexes put the Arabic code-span match first.
    const raw = perLanguage.flatMap(({ language, result }) => result.hits.map((hit) => ({ ...hit, language }))).sort((a, b) => b.score - a.score);
    expect(raw[0]?.language).toBe('ar');
    const merged = mergeLanguageSearchHits(perLanguage, 10, 'en');
    expect(merged[0]?.language).toBe('en');
    if (query === 'export') expect(merged[0]?.id).toBe('en-export');
    expect(merged.findIndex((hit) => hit.id === 'en-export')).toBeLessThan(merged.findIndex((hit) => hit.id === 'ar-export'));
    // The translation stays available, below every English result.
    const arabicAt = merged.findIndex((hit) => hit.id === 'ar-export');
    expect(arabicAt).toBeGreaterThan(merged.findLastIndex((hit) => hit.language === 'en'));
  });

  it('ranks the Arabic page first for an Arabic reader searching Arabic, with English below', async () => {
    const perLanguage = await search('تصدير');
    const merged = mergeLanguageSearchHits(perLanguage, 10, 'ar');
    expect(merged[0]).toMatchObject({ id: 'ar-export', language: 'ar' });
    expect(merged.every((hit, index) => hit.language === 'ar' || merged.slice(index).every((rest) => rest.language !== 'ar'))).toBe(true);
  });

  it('puts an Arabic reader’s own language first even when the English index scores higher', () => {
    const hit = (id: string, score: number) => ({ id, title: id, path: id, description: '', snippet: '', score });
    const merged = mergeLanguageSearchHits(
      [
        { language: 'en', result: { hits: [hit('en-export', 40), hit('en-sync', 30)] } },
        { language: 'ar', result: { hits: [hit('ar-export', 2)] } },
      ],
      10,
      'ar',
    );
    expect(merged.map((item) => item.id)).toEqual(['ar-export', 'en-export', 'en-sync']);
  });

  it('keeps every language represented when the limit is tight', () => {
    const hit = (id: string, score: number) => ({ id, title: id, path: id, description: '', snippet: '', score });
    const merged = mergeLanguageSearchHits(
      [
        { language: 'en', result: { hits: [hit('en-1', 9), hit('en-2', 8), hit('en-3', 7)] } },
        { language: 'ar', result: { hits: [hit('ar-1', 90), hit('ar-2', 80), hit('ar-3', 70)] } },
      ],
      3,
      'en',
    );
    expect(merged.map((item) => item.id)).toEqual(['en-1', 'en-2', 'ar-1']);
  });
});

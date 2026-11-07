import { describe, expect, it } from 'vitest';
import { readerLanguageFirst } from './site-search-rank';

// What the search API returned for "export" on an English site with an Arabic
// translation: the Arabic page matched only through a CLI flag in a code span.
const hits = [
  { id: 'ar-export', title: 'تصدير ملاحظاتك', language: 'ar' },
  { id: 'en-export', title: 'Export your notes', language: 'en' },
  { id: 'en-sync', title: 'Sync across devices', language: 'en' },
  { id: 'ar-sync', title: 'المزامنة بين الأجهزة', language: 'ar' },
];

describe('reader search order', () => {
  it('lists an English reader’s English results first and keeps the translation below', () => {
    expect(readerLanguageFirst(hits, 'en').map((hit) => hit.id)).toEqual(['en-export', 'en-sync', 'ar-export', 'ar-sync']);
  });

  it('lists an Arabic reader’s Arabic results first', () => {
    expect(readerLanguageFirst(hits, 'ar').map((hit) => hit.id)).toEqual(['ar-export', 'ar-sync', 'en-export', 'en-sync']);
  });

  it('matches the reader’s language code exactly, so pt-PT is not a pt-BR reader’s own', () => {
    const portuguese = [
      { id: 'pt-pt', language: 'pt-PT' },
      { id: 'pt-br', language: 'pt-BR' },
    ];
    expect(readerLanguageFirst(portuguese, 'pt-BR').map((hit) => hit.id)).toEqual(['pt-br', 'pt-pt']);
  });

  it('keeps the server order when the reader language is unknown', () => {
    expect(readerLanguageFirst(hits).map((hit) => hit.id)).toEqual(hits.map((hit) => hit.id));
  });
});

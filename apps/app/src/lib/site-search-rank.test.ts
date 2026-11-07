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

  it('lists an Arabic reader’s Arabic results first, matching regional codes', () => {
    expect(readerLanguageFirst(hits, 'ar-SA').map((hit) => hit.id)).toEqual(['ar-export', 'ar-sync', 'en-export', 'en-sync']);
  });

  it('keeps the server order when the reader language is unknown', () => {
    expect(readerLanguageFirst(hits).map((hit) => hit.id)).toEqual(hits.map((hit) => hit.id));
  });
});

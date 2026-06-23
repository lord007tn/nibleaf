import { describe, expect, it } from 'vitest';
import { createDocIndex, oramaLanguageForCode, type SearchDoc, searchDocs } from './index';

const arabicDocs: SearchDoc[] = [
  {
    id: '1',
    title: 'تثبيت المنصة',
    path: 'install',
    description: 'دليل التثبيت',
    headings: 'المتطلبات',
    content: 'لتثبيت المنصة تحتاج إلى اتصال بالإنترنت ومتصفح حديث.',
  },
  {
    id: '2',
    title: 'إدارة الحجوزات',
    path: 'bookings',
    description: 'دليل الحجوزات',
    headings: 'الحجوزات',
    content: 'يمكنك إدارة جميع الحجوزات من لوحة التحكم بسهولة.',
  },
];

const englishDocs: SearchDoc[] = [
  {
    id: 'a',
    title: 'Installation',
    path: 'install',
    description: 'Install guide',
    headings: 'Requirements',
    content: 'To install the platform you need internet access and a modern browser.',
  },
  {
    id: 'b',
    title: 'Managing bookings',
    path: 'bookings',
    description: 'Bookings guide',
    headings: 'Bookings',
    content: 'You can manage all your bookings from the dashboard.',
  },
];

describe('oramaLanguageForCode', () => {
  it('maps a primary subtag to its Orama tokenizer', () => {
    expect(oramaLanguageForCode('ar')).toBe('arabic');
    expect(oramaLanguageForCode('ar-SA')).toBe('arabic');
    expect(oramaLanguageForCode('en-US')).toBe('english');
    expect(oramaLanguageForCode('fr')).toBe('french');
  });
  it('defaults to English for unknown or empty codes', () => {
    expect(oramaLanguageForCode('xx')).toBe('english');
    expect(oramaLanguageForCode(undefined)).toBe('english');
  });
});

describe('Arabic search (regression: language-aware tokenizer)', () => {
  it('returns zero hits for an Arabic query under the English tokenizer', async () => {
    const enIndex = await createDocIndex(arabicDocs, 'english');
    const hits = await searchDocs(enIndex, 'تثبيت', { tolerance: 1 });
    expect(hits).toHaveLength(0);
  });
  it('returns hits for an Arabic query under the Arabic tokenizer', async () => {
    const arIndex = await createDocIndex(arabicDocs, 'arabic');
    const hits = await searchDocs(arIndex, 'تثبيت', { tolerance: 1 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe('1');
  });
});

describe('English search', () => {
  it('finds the relevant doc', async () => {
    const index = await createDocIndex(englishDocs, 'english');
    const hits = await searchDocs(index, 'install', { tolerance: 1 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe('a');
  });
  it('returns nothing for an empty query', async () => {
    const index = await createDocIndex(englishDocs, 'english');
    expect(await searchDocs(index, '   ')).toHaveLength(0);
  });
});

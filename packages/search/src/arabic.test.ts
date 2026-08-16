import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createDocIndex, lightStemArabicToken, normalizeArabicMorphologyText, normalizeArabicSearchText, type SearchDoc, searchDocs } from './index';

const doc = (id: string, title: string, content = ''): SearchDoc => ({
  id,
  title,
  path: id,
  description: '',
  headings: '',
  content,
});

describe('lightStemArabicToken', () => {
  it.each([
    ['المستخدم', 'مستخدم'],
    ['والمستخدمين', 'مستخدم'],
    ['بالمستخدمات', 'مستخدمة'],
    ['للمطورين', 'مطور'],
    ['لمستخدمين', 'مستخدم'],
    ['كمطورين', 'مطور'],
    ['بمستنداتهم', 'مستند'],
    ['ومستخدمون', 'مستخدم'],
    ['كتابهم', 'كتاب'],
    ['إعداداتهم', 'اعداد'],
    ['إعداداتكما', 'اعداد'],
    ['المكتبتين', 'مكتبة'],
    ['مكتبات', 'مكتبة'],
    ['صلاحيات', 'صلاحية'],
    ['واجهات', 'واجهة'],
    ['سيارات', 'سيارة'],
    ['تحديثات', 'تحديث'],
    ['مستندات', 'مستند'],
    ['المطوران', 'مطور'],
    ['فالاشعارات', 'اشعار'],
  ])('normalizes %s to the conservative search form %s', (surface, expected) => {
    expect(lightStemArabicToken(surface)).toBe(expected);
  });

  it.each([
    'في',
    'من',
    'وال',
    'محمد',
    'الرياض',
    'والرياض',
    'قوانين',
    'عناوين',
    'وثائق',
    'فواتير',
    'برمجة',
    'APIالمستخدمين',
    'v2-المستخدمين',
    'المستخدم_الجديد',
  ])('protects ambiguous, short, proper, or technical token %s', (surface) => {
    expect(lightStemArabicToken(surface)).toBe(normalizeArabicSearchText(surface));
  });

  it('omits code and mixed-script identifiers only from the morphology channel', () => {
    expect(normalizeArabicMorphologyText('APIالمستخدمين v2-المستخدمين `المستخدمين`')).not.toContain('مستخدم');
    expect(normalizeArabicSearchText('APIالمستخدمين')).toBe('APIالمستخدمين');
  });

  it('never applies aggressive root extraction', () => {
    expect(lightStemArabicToken('استخدام')).toBe('استخدام');
    expect(lightStemArabicToken('مكتوب')).toBe('مكتوب');
    expect(lightStemArabicToken('استعلام')).toBe('استعلام');
  });
});

describe('Arabic morphological search corpus', () => {
  it.each([
    ['مستخدم', 'إدارة للمستخدمين'],
    ['إعداد', 'إعداداتهم المتقدمة'],
    ['مكتبة', 'المكتبتان الرقميتان'],
    ['مطور', 'دليل المطورون'],
    ['كتاب', 'مشاركة كتابهم'],
    ['صلاحية', 'ضبط الصلاحيات'],
    ['واجهة', 'واجهات الاستخدام'],
    ['إشعار', 'فالاشعارات الجديدة'],
    ['مستخدمة', 'دليل المستخدمات'],
    ['مستخدم', 'شرح لمستخدمين جدد'],
  ])('finds %s in the inflected surface %s', async (query, surface) => {
    const index = await createDocIndex([doc('match', surface)], 'arabic');
    expect((await searchDocs(index, query, { tolerance: 0 }))[0]?.id).toBe('match');
  });

  it.each([
    ['مكتبة', doc('offices', 'مكاتب الشركة')],
    ['قانون', doc('laws', 'قوانين النشر')],
    ['رياض', doc('city', 'الرياض')],
    ['مستخدم', doc('identifier', 'APIالمستخدمين')],
    ['مستخدم', doc('code', 'مثال', 'شغّل `المستخدمين` داخل المثال.')],
  ])('does not introduce the harmful match %s -> %s', async (query, source) => {
    const index = await createDocIndex([source], 'arabic');
    expect(await searchDocs(index, query, { tolerance: 0 })).toHaveLength(0);
  });

  it('keeps an exact normalized title match ahead of a morphology-only title match', async () => {
    const index = await createDocIndex(
      [doc('morph', 'إدارة المستخدمين'), doc('exact', 'إدارة المستخدم'), doc('body', 'إدارة', 'يوجد المستخدم في محتوى الصفحة.')],
      'arabic',
    );
    const hits = await searchDocs(index, 'المستخدم', { tolerance: 0 });
    expect(hits.map((hit) => hit.id)).toEqual(['exact', 'body', 'morph']);
    expect(hits[0]?.score).toBeGreaterThan(hits[2]?.score ?? 0);
  });

  it('preserves normalized exact phrase/title strength', async () => {
    const index = await createDocIndex(
      [doc('morph', 'إعدادات الحسابات'), doc('exact', 'إِعْدَاد الحساب'), doc('content', 'الحساب', 'راجع إعداد الحساب هنا.')],
      'arabic',
    );
    expect((await searchDocs(index, 'اعداد الحساب', { tolerance: 0 }))[0]?.id).toBe('exact');
  });

  it('matches spaced Arabic/Latin prose but protects a mixed technical identifier', async () => {
    const index = await createDocIndex(
      [doc('prose', 'API للمستخدمين'), doc('identifier', 'APIالمستخدمين'), doc('versioned', 'v2-المستخدمين')],
      'arabic',
    );
    const hits = await searchDocs(index, 'API مستخدم', { tolerance: 0 });
    expect(hits.map((hit) => hit.id)).toContain('prose');
    expect((await searchDocs(index, 'APIالمستخدمين', { tolerance: 0 }))[0]?.id).toBe('identifier');
  });

  it('combines fuzzy typo tolerance with morphology without increasing tolerance', async () => {
    const index = await createDocIndex([doc('users', 'دليل للمستخدمين')], 'arabic');
    expect((await searchDocs(index, 'مستخدك'))[0]?.id).toBe('users');
    expect(await searchDocs(index, 'مستدك', { tolerance: 1 })).toHaveLength(0);
  });

  it('honors small result limits after merging direct and morphology candidates', async () => {
    const index = await createDocIndex(
      [doc('exact', 'مستخدم'), ...Array.from({ length: 20 }, (_, index) => doc(`morph-${index}`, `المستخدمون ${index}`))],
      'arabic',
    );
    const hits = await searchDocs(index, 'مستخدم', { tolerance: 0, limit: 3 });
    expect(hits).toHaveLength(3);
    expect(hits[0]?.id).toBe('exact');
  });

  it('keeps direct-result limits backward compatible above the morphology candidate cap', async () => {
    const index = await createDocIndex(
      Array.from({ length: 80 }, (_, index) => doc(`exact-${index}`, `مستخدم ${index}`)),
      'arabic',
    );
    expect(await searchDocs(index, 'مستخدم', { tolerance: 0, limit: 75 })).toHaveLength(75);
  });

  it('centers snippets on an inflected morphology-only occurrence', async () => {
    const content = `${'مقدمة بعيدة عن النتيجة. '.repeat(20)}هذه التعليمات مخصصة للمستخدمين في لوحة التحكم.`;
    const index = await createDocIndex([doc('users', 'دليل الحساب', content)], 'arabic');
    const hit = (await searchDocs(index, 'مستخدم', { tolerance: 0 }))[0];
    expect(hit?.snippet).toContain('للمستخدمين');
    expect(hit?.snippet.startsWith('…')).toBe(true);
  });
});

describe('Arabic morphology performance guards', () => {
  it('analyzes a large documentation sample within a bounded linear-time budget', () => {
    const sample = 'والمستخدمين إعداداتهم API-v2 `المكتبات` واجهات المطورين. '.repeat(4_000);
    const started = performance.now();
    const analyzed = normalizeArabicMorphologyText(sample);
    const elapsed = performance.now() - started;

    expect(analyzed.length).toBeLessThanOrEqual(sample.length);
    expect(elapsed).toBeLessThan(1_500);
  });

  it('keeps indexing and repeated morphology queries below the regression ceiling', async () => {
    const docs = Array.from({ length: 300 }, (_, index) =>
      doc(`doc-${index}`, `إعدادات المستخدمين ${index}`, 'دليل للمطورين يشرح الصلاحيات والواجهات والحسابات.'),
    );
    const started = performance.now();
    const index = await createDocIndex(docs, 'arabic');
    for (let iteration = 0; iteration < 20; iteration += 1) {
      await searchDocs(index, 'مستخدم', { tolerance: 1 });
    }
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

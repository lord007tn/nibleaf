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
    ['بالمستخدمات', 'مستخدم'],
    ['للمطورين', 'مطور'],
    ['لمستخدمين', 'مستخدم'],
    ['كمطورين', 'مطور'],
    ['بمستنداتهم', 'مستند'],
    ['ومستخدمون', 'مستخدم'],
    ['كتابهم', 'كتاب'],
    ['إعداداتهم', 'اعداد'],
    ['إعداداتكما', 'اعداد'],
    ['المكتبتين', 'مكتب'],
    ['مكتبة', 'مكتب'],
    ['مكتبات', 'مكتب'],
    ['صلاحية', 'صلاح'],
    ['صلاحيات', 'صلاح'],
    ['واجهة', 'واجه'],
    ['واجهات', 'واجه'],
    ['سيارة', 'سيار'],
    ['سيارات', 'سيار'],
    ['تحديثات', 'تحديث'],
    ['مستندات', 'مستند'],
    ['المطوران', 'مطور'],
    ['فالاشعارات', 'اشعار'],
    ['برمجة', 'برمج'],
    ['مكتبتهم', 'مكتب'],
    ['ملفهما', 'ملف'],
    ['حسابنا', 'حساب'],
    ['خياركم', 'خيار'],
  ])('normalizes %s to the conservative search form %s', (surface, expected) => {
    expect(lightStemArabicToken(surface)).toBe(expected);
  });

  it.each([
    'في',
    'من',
    'وال',
    'محمد',
    'الرياض',
    'قوانين',
    'عناوين',
    'وثائق',
    'فواتير',
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

  it('removes only the conjunction from a protected proper noun', () => {
    expect(lightStemArabicToken('والرياض')).toBe('الرياض');
  });

  it('uses a scanner for varied Markdown code fences and unmatched delimiters', () => {
    const analyzed = normalizeArabicMorphologyText('مستخدم\n  ~~~~ts\nالمستخدمين\n~~~~\n``المستخدمين`` ونهاية ` مفردة');
    expect(analyzed).toContain('مستخدم');
    expect(analyzed).not.toContain('المستخدمين');
    expect(analyzed).toContain('مفرد');
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
    ['برنامج', doc('programming', 'أساسيات البرمجة')],
  ])('does not introduce the harmful match %s -> %s', async (query, source) => {
    const index = await createDocIndex([source], 'arabic');
    expect(await searchDocs(index, query, { tolerance: 0 })).toHaveLength(0);
  });

  it('matches a protected proper noun with an outer conjunction but not its ambiguous unmarked word', async () => {
    const index = await createDocIndex([doc('city', 'والرياض')], 'arabic');
    expect((await searchDocs(index, 'الرياض', { tolerance: 0 }))[0]?.id).toBe('city');
    expect(await searchDocs(index, 'رياض', { tolerance: 0 })).toHaveLength(0);
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

  it('keeps fused ranking stable when insertion order changes', async () => {
    const sources = [doc('morph', 'دليل المستخدمين'), doc('exact', 'دليل المستخدم'), doc('body', 'دليل الحساب', 'شرح المستخدم هنا.')];
    const forward = await createDocIndex(sources, 'arabic');
    const reverse = await createDocIndex([...sources].reverse(), 'arabic');
    const forwardIds = (await searchDocs(forward, 'المستخدم', { tolerance: 1 })).map((hit) => hit.id);
    const reverseIds = (await searchDocs(reverse, 'المستخدم', { tolerance: 1 })).map((hit) => hit.id);
    expect(forwardIds).toEqual(reverseIds);
    expect(forwardIds[0]).toBe('exact');
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

  it('handles many malformed unmatched code delimiters within the same budget', () => {
    const sample = Array.from({ length: 4_000 }, () => '` مستخدم دون اغلاق').join('\n');
    const started = performance.now();
    const analyzed = normalizeArabicMorphologyText(sample);
    expect(analyzed).toContain('مستخدم');
    expect(performance.now() - started).toBeLessThan(1_500);
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

import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { cleanSearchText, createDocIndex, normalizeArabicSearchText, readerSearchTerms, type SearchDoc, searchDocs } from './index';

const doc = (id: string, title: string, content = ''): SearchDoc => ({ id, title, path: id, content, headings: '', description: '' });
const reader = { relevance: 'reader' as const };

describe('published reader relevance', () => {
  it.each([`${' '.repeat(99_999)}x`, 'a '.repeat(50_000), '[('.repeat(50_000), '<!--'.repeat(25_000)])(
    'handles a 100k-character adversarial query on the linear normalization path',
    (query) => {
      readerSearchTerms('warm up');
      cleanSearchText('warm up');
      const started = performance.now();
      const terms = readerSearchTerms(query);
      const text = cleanSearchText(query);
      const elapsed = performance.now() - started;
      expect(query).toHaveLength(100_000);
      expect(terms.size).toBeLessThanOrEqual(1);
      expect(text.length).toBeLessThanOrEqual(query.length);
      expect(elapsed).toBeLessThan(50);
    },
  );

  it('rejects oversized reader queries before retrieval', async () => {
    const index = await createDocIndex([doc('invoice', 'Invoice')]);
    const started = performance.now();
    expect(await searchDocs(index, 'invoice '.repeat(12_500), reader)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(50);
  });
  it('returns no fuzzy padding for nonsense or a missing password page', async () => {
    const index = await createDocIndex([
      doc('invoice', 'Invoice', 'Download your invoice.'),
      doc('passport', 'Passport records', 'A passwore is a deliberately close typo in unrelated material.'),
      doc('noise', 'Sense of direction', 'No sense in the xyzv example.'),
    ]);
    expect(await searchDocs(index, 'xqzv nonsense', reader)).toEqual([]);
    expect(await searchDocs(index, 'password', reader)).toEqual([]);
    expect((await searchDocs(index, 'invoice', reader))[0]?.id).toBe('invoice');
    expect((await searchDocs(index, 'invoi', reader))[0]?.id).toBe('invoice');
  });

  it('drops weak tails while retaining title, heading and body matches', async () => {
    const index = await createDocIndex([
      doc('cancel', 'Cancel reservation', 'Open the reservation and cancel it.'),
      doc('tail', 'Dashboard', 'The reservation is displayed here.'),
      { ...doc('heading', 'Booking guide', 'Follow the steps.'), headings: 'Cancel reservation' },
      doc('body', 'Billing', 'Download the invoice from your account.'),
    ]);
    expect((await searchDocs(index, 'cancel reservation', reader)).map((hit) => hit.id)).toEqual(['cancel', 'heading']);
    expect((await searchDocs(index, 'invoice', reader))[0]?.id).toBe('body');
  });

  it('applies the relative floor to weak prefix-only body matches', async () => {
    const index = await createDocIndex([
      doc('invoice', 'Invoice'),
      doc('body', 'Billing', 'Download your invoice.'),
      doc('weak-prefix', 'Exports', 'A list of invoices.'),
    ]);
    expect((await searchDocs(index, 'invoice', reader)).map((hit) => hit.id)).toEqual(['invoice', 'body']);
  });

  it('keeps Arabic recall and folds ta marbuta only for matching', async () => {
    const index = await createDocIndex(
      [doc('invoice', 'الفاتورة', 'حمّل الفاتورة من الحساب.'), doc('cancel', 'إلغاء الحجز', 'يمكن إلغاء الحجز هنا.')],
      'arabic',
    );
    expect(normalizeArabicSearchText('الفاتورة')).toBe(normalizeArabicSearchText('الفاتوره'));
    expect((await searchDocs(index, 'الفاتوره', reader))[0]).toMatchObject({ id: 'invoice', title: 'الفاتورة', snippet: 'حمّل الفاتورة من الحساب.' });
    expect((await searchDocs(index, 'إلغاء الحجز', reader))[0]?.id).toBe('cancel');
    expect(await searchDocs(index, 'xqzv nonsense', reader)).toEqual([]);
  });

  it('cleans imported markdown once and centers on the first present query term', async () => {
    const content = `> [!IMPORTANT]\n---\n\\-1- To extend [reservations](https://example.test) use <b>Settings</b>. ![](zvtn4xmp.jpg) \\-6- Save.\n${'Opening text. '.repeat(30)}Download the invoice now. ${'Trailing text. '.repeat(30)}`;
    const index = await createDocIndex([doc('billing', 'Billing', content)]);
    const hit = (await searchDocs(index, 'missing invoice', reader))[0];
    // One body term in a two-term query is intentionally below the floor.
    expect(hit).toBeUndefined();
    const [invoice] = await searchDocs(index, 'invoice', reader);
    expect(invoice?.snippet).toContain('invoice');
    expect(invoice?.snippet).not.toMatch(/\\-|jpg\)|\[!|---|<b>|\]\(/);
    expect(cleanSearchText(content)).toContain('To extend reservations use Settings. Save.');
    expect(cleanSearchText('<section><button>Invoice</button></section>')).toBe('Invoice');
  });
});

import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { cleanSearchText, createDocIndex, foldSearchText, normalizeArabicSearchText, readerSearchTerms, type SearchDoc, searchDocs } from './index';

const doc = (id: string, title: string, content = ''): SearchDoc => ({ id, title, path: id, content, headings: '', description: '' });
const reader = { relevance: 'reader' as const };

/**
 * Calibrated timing for the ReDoS cases: the same work at n and at 4n, on the
 * same runner, measured in alternating order after a warmup so GC and JIT state
 * are shared (median of 3). Linear work grows about 4x; quadratic grows 16x. The
 * bound is 8x plus 20 ms, so a case that runs in a few milliseconds isn't judged
 * on timer jitter. Each row's n is large enough that its small run takes about
 * 4 ms here, above the 2.5 ms where 16x would still fit under 8x + 20 ms.
 */
const growthMs = (small: string, large: string): [number, number] => {
  const time = (input: string) => {
    const started = performance.now();
    readerSearchTerms(input);
    cleanSearchText(input);
    return performance.now() - started;
  };
  time(small);
  time(large);
  const times: [number[], number[]] = [[], []];
  for (let round = 0; round < 3; round += 1) {
    if (round % 2 === 0) {
      times[0].push(time(small));
      times[1].push(time(large));
    } else {
      times[1].push(time(large));
      times[0].push(time(small));
    }
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[1] ?? 0;
  return [median(times[0]), median(times[1])];
};

describe('published reader relevance', () => {
  // ReDoS bounds (CodeQL js/polynomial-redos): untrusted queries and page bodies
  // must stay linear. Steady-state latency lives in `pnpm bench:reader`.
  it.each([
    ['spaces, then one letter', (n: number) => `${' '.repeat(n - 1)}x`, 240_000],
    ['letter-space pairs', (n: number) => 'a '.repeat(n / 2), 100_000],
    ['open brackets', (n: number) => '[('.repeat(n / 2), 320_000],
    ['unclosed comments', (n: number) => '<!--'.repeat(n / 4), 400_000],
    ['backticks', (n: number) => '`'.repeat(n), 600_000],
    ['unbalanced code spans', (n: number) => '`a``'.repeat(n / 4), 64_000],
    ['unclosed fences', (n: number) => '```\n'.repeat(n / 4), 64_000],
    ['unclosed tags, then one letter', (n: number) => `${'<T>'.repeat(n / 3)}x`, 78_000],
  ] as const)('stays linear on adversarial input: %s', (_label, build, n) => {
    const small = build(n);
    const large = build(4 * n);
    expect(large.length).toBeGreaterThanOrEqual(4 * n - 3);
    expect(readerSearchTerms(large).size).toBeLessThanOrEqual(2);
    expect(cleanSearchText(large).length).toBeLessThanOrEqual(large.length + 2);
    const [smaller, larger] = growthMs(small, large);
    expect(larger).toBeLessThanOrEqual(8 * smaller + 20);
  });

  it('rejects oversized reader queries before retrieval', async () => {
    const index = await createDocIndex([doc('invoice', 'Invoice')]);
    expect(await searchDocs(index, 'invoice '.repeat(12_500), reader)).toEqual([]);
    expect(await searchDocs(index, `${'invoice '.repeat(24)}invoice`, reader)).toEqual([expect.objectContaining({ id: 'invoice' })]);
  });

  // Orama folds accents when it indexes and queries; relevance must fold the same
  // way or it rejects what retrieval found. Display keeps the original text.
  it.each([
    ['cafe', 'Café', 'Order at the café counter.'],
    ['resume', 'Résumé', 'Upload your résumé here.'],
    ['café', 'Cafe', 'Order at the cafe counter.'],
  ])('matches %s to %s through the retrieval tokenizer accent folding', async (query, title, body) => {
    const index = await createDocIndex([doc('page', title, body), doc('other', 'Billing', 'Download your invoice.')]);
    const hits = await searchDocs(index, query, reader);
    expect(hits.map((hit) => hit.id)).toEqual(['page']);
    expect(hits[0]?.title).toBe(title);
    expect(hits[0]?.snippet).toBe(body);
  });

  it('folds accents in French indexes too and centers the snippet on the accented word', async () => {
    const filler = 'Texte d’introduction sans rapport. '.repeat(12);
    const index = await createDocIndex([doc('cv', 'Candidature', `${filler}Joignez votre Résumé au dossier.`)], 'french');
    const [hit] = await searchDocs(index, 'resume', reader);
    expect(hit?.id).toBe('cv');
    expect(hit?.snippet).toContain('Résumé');
  });

  it('keeps identifiers from fenced and inline code searchable', async () => {
    const index = await createDocIndex([
      doc('button', 'Forms', 'Render a save button:\n\n```tsx\n<Button>Save</Button>\n```\n\nThen submit.'),
      doc('generics', 'Collections', 'Use a typed `Map<T>` for lookups.'),
      doc('other', 'Billing', 'Download your invoice.'),
    ]);
    expect((await searchDocs(index, 'Button', reader)).map((hit) => hit.id)).toEqual(['button']);
    expect((await searchDocs(index, 'T', reader)).map((hit) => hit.id)).toEqual(['generics']);
    expect(cleanSearchText('```tsx\n<Button>Save</Button>\n```')).toBe('<Button>Save</Button>');
    expect(cleanSearchText('Use a typed `Map<T>` for lookups.')).toBe('Use a typed Map<T> for lookups.');
  });

  it('removes markup from prose only, keeping code literal', () => {
    expect(cleanSearchText('<Callout>Use **care**</Callout> with `<Callout>` and\n~~~\n# not a heading\n~~~')).toBe(
      'Use care with <Callout> and # not a heading',
    );
    // An unclosed fence runs to the end of the page; an unmatched backtick stays text.
    expect(cleanSearchText('Intro.\n\n````js\nconst a = `x`;\n```\nstill code')).toBe('Intro. const a = `x`; ``` still code');
    expect(cleanSearchText('A lone ` backtick and ``a pair``.')).toBe('A lone ` backtick and a pair.');
    // Author text cannot forge a code placeholder.
    expect(cleanSearchText(`${String.fromCharCode(0xe0_00)}0${String.fromCharCode(0xe0_01)} <b>x</b>`)).toBe('0 x');
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

describe('foldSearchText', () => {
  it('folds page-sized text without overflowing the stack, unit for unit', () => {
    const page = 'Café résumé naïve. '.repeat(200_000);
    const folded = foldSearchText(page);
    expect(folded).toHaveLength(page.length);
    expect(folded.slice(0, 19)).toBe('cafe resume naive. ');
    expect(folded.endsWith('cafe resume naive. ')).toBe(true);
  });
});

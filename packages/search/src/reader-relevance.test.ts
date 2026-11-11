import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { cleanSearchText, createDocIndex, foldSearchText, normalizeArabicSearchText, readerSearchTerms, type SearchDoc, searchDocs } from './index';

const doc = (id: string, title: string, content = ''): SearchDoc => ({ id, title, path: id, content, headings: '', description: '' });
const reader = { relevance: 'reader' as const };

/** Calibrated timing for the ReDoS cases: the same machine's time for a plain
 *  linear pass over the same input. A slow CI core slows both sides equally,
 *  while superlinear growth (hundreds of times slower at 100k) is still caught. */
const linearPassMs = (input: string): number => {
  const runs: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    const started = performance.now();
    let letters = 0;
    for (let index = 0; index < input.length; index += 1) if (/\p{L}/u.test(input[index] ?? '')) letters += 1;
    if (letters < 0) throw new Error('unreachable');
    runs.push(performance.now() - started);
  }
  return runs.sort((a, b) => a - b)[1] ?? 0;
};
const medianMs = (run: () => void): number => {
  run();
  const runs: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    const started = performance.now();
    run();
    runs.push(performance.now() - started);
  }
  return runs.sort((a, b) => a - b)[1] ?? 0;
};

describe('published reader relevance', () => {
  // ReDoS bounds (CodeQL js/polynomial-redos): untrusted queries and page bodies
  // must stay linear. Steady-state latency lives in `pnpm bench:reader`.
  it.each([
    `${' '.repeat(99_999)}x`,
    'a '.repeat(50_000),
    '[('.repeat(50_000),
    '<!--'.repeat(25_000),
    '`'.repeat(100_000),
    '`a``'.repeat(25_000),
    '```\n'.repeat(25_000),
    `${'<T>'.repeat(33_333)}x`,
  ])('stays linear on a 100k-character adversarial input', (input) => {
    expect(input.length).toBeGreaterThanOrEqual(99_999);
    const terms = readerSearchTerms(input);
    const text = cleanSearchText(input);
    expect(terms.size).toBeLessThanOrEqual(2);
    expect(text.length).toBeLessThanOrEqual(input.length + 2);
    const elapsed = medianMs(() => {
      readerSearchTerms(input);
      cleanSearchText(input);
    });
    expect(elapsed).toBeLessThanOrEqual(10 * linearPassMs(input) + 20);
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

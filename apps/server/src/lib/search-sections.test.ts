import { describe, expect, it } from 'vitest';
import { matchedSearchSection } from './search-sections';

const billing = {
  title: 'Billing and plans',
  content: [
    'Everything about paying lives on the **Billing** page.',
    '',
    '## Change your plan',
    '',
    'Open **Settings → Billing** and choose a plan.',
    '',
    '## Download invoices',
    '',
    'Every invoice is listed under Billing history.',
    '',
    '```bash',
    '## not a heading inside code',
    'curl https://example.com/invoices',
    '```',
    '',
    '## Cancel your subscription',
    '',
    'You can cancel at any time. Your pages stay online.',
    '',
    '### Refunds',
    '',
    'If you were charged by mistake, we refund the full amount.',
  ].join('\n'),
};

describe('matchedSearchSection', () => {
  it('points at a heading that names the query, previewing that section', () => {
    expect(matchedSearchSection(billing, 'cancel subscription')).toEqual({
      section: { id: 'cancel-your-subscription', title: 'Cancel your subscription' },
      snippet: 'You can cancel at any time. Your pages stay online.',
    });
  });

  it('falls back to the first section whose body mentions the query', () => {
    expect(matchedSearchSection(billing, 'mistake')?.section).toEqual({ id: 'refunds', title: 'Refunds' });
    expect(matchedSearchSection(billing, 'mistake')?.snippet).toBe('If you were charged by mistake, we refund the full amount.');
  });

  it('keeps heading anchors aligned when code fences contain heading-like lines', () => {
    expect(matchedSearchSection(billing, 'curl')?.section.id).toBe('download-invoices');
    expect(matchedSearchSection(billing, 'curl')?.snippet).toContain('curl https://example.com/invoices');
  });

  it('leaves page-level matches and introduction-only matches on the page itself', () => {
    expect(matchedSearchSection(billing, 'billing plans')).toBeUndefined();
    expect(matchedSearchSection(billing, 'paying')).toBeUndefined();
    expect(matchedSearchSection(billing, 'x')).toBeUndefined();
  });

  it('matches Arabic headings regardless of diacritics and alef forms', () => {
    const page = { title: 'الفوترة', content: '## إلغاء الاشتراك\n\nيمكنك الإلغاء في أي وقت.' };
    expect(matchedSearchSection(page, 'الاشتراك')?.section).toEqual({ id: 'إلغاء-الاشتراك', title: 'إلغاء الاشتراك' });
    expect(matchedSearchSection(page, 'الغاء')?.section.title).toBe('إلغاء الاشتراك');
  });

  it('trims long section previews on word boundaries around the match', () => {
    const long = { title: 'Guide', content: `## Setup\n\n${'word '.repeat(80)}needle ${'tail '.repeat(80)}` };
    const snippet = matchedSearchSection(long, 'needle')?.snippet ?? '';
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…word')).toBe(true);
    expect(snippet.endsWith('tail…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(184);
  });
});

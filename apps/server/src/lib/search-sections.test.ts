import {
  AFTER_FENCE,
  CODERABBIT_REPROS,
  CONTINUATION_FENCE_REPROS,
  FENCE_CONTAINER_REPROS,
  HTML_BLOCK_HEADING_REPROS,
  HTML_BLOCK_REPEATED_HEADING,
  INDENTED_FENCE_AFTER_QUOTE,
  LAZY_INLINE_HTML_REPROS,
  LAZY_TEXT_AFTER_INLINE_HTML,
} from '@nibleaf/shared/testing/fence-cases';
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
  it('uses clean plain text for imported callouts, escaped lists, images and HTML', () => {
    const page = {
      title: 'Guide',
      content:
        '## Billing\n\n> [!IMPORTANT]\n---\n\\-1- Download the [invoice](https://example.test) from <b>Billing</b>. ![](zvtn4xmp.jpg) \\-6- Save.',
    };
    expect(matchedSearchSection(page, 'invoice')?.snippet).toBe('Download the invoice from Billing. Save.');
  });
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

  it('picks the section that matches the most query words, weighting headings', () => {
    expect(matchedSearchSection(billing, 'billing invoices')?.section.id).toBe('download-invoices');
    expect(matchedSearchSection(billing, 'mistake refund')?.section.id).toBe('refunds');
  });

  it('keeps the Arabic preview on the match when the text carries diacritics', () => {
    const filler = 'نَصٌّ تَمْهِيدِيٌّ طَوِيلٌ '.repeat(20);
    const page = {
      title: 'دليل',
      content: `## الإعدادات

${filler}يمكنك إِلْغَاءُ الاشتراك في أي وقت ${filler}`,
    };
    const snippet = matchedSearchSection(page, 'الغاء')?.snippet ?? '';
    expect(snippet).toContain('إِلْغَاءُ الاشتراك');
  });

  it('never treats a heading-like line in tilde, longer or list fences as a section', () => {
    const page = {
      title: 'Guide',
      content: ['## Setup', '', '~~~md', '## Fake', 'needle', '~~~', '', '- step', '  ````', '  ## Also fake', '  ````'].join('\n'),
    };
    expect(matchedSearchSection(page, 'needle')?.section).toEqual({ id: 'setup', title: 'Setup' });
    expect(matchedSearchSection(page, 'fake')?.section.id).toBe('setup');
  });

  it('parses a published page once per cache key', () => {
    const first = matchedSearchSection(billing, 'mistake', 'deployment-1:billing');
    // Same key, different body: the cached sections are reused rather than re-parsed.
    const second = matchedSearchSection({ ...billing, content: '## Other\n\nmistake here' }, 'mistake', 'deployment-1:billing');
    expect(second?.section).toEqual(first?.section);
    expect(matchedSearchSection({ ...billing, content: '## Other\n\nmistake here' }, 'mistake', 'deployment-2:billing')?.section.id).toBe('other');
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

  it.each(FENCE_CONTAINER_REPROS)('finds the section after %s (#587)', (_name, example) => {
    const page = { title: 'Guide', content: `${example}${AFTER_FENCE}\n\nThe after section mentions zebras.` };
    expect(matchedSearchSection(page, 'zebras')?.section).toEqual({ id: 'after', title: 'After' });
  });

  it.each(CODERABBIT_REPROS)('finds the section after %s (#590 CodeRabbit review)', (_name, example) => {
    const page = { title: 'Guide', content: `${example}\n\nThe after section mentions zebras.` };
    expect(matchedSearchSection(page, 'zebras')?.section).toEqual({ id: 'after', title: 'After' });
  });

  it.each(HTML_BLOCK_HEADING_REPROS)('finds the section after %s, not a heading inside it (#593)', (_name, source) => {
    const page = {
      title: 'Guide',
      content: `${source}

The after section mentions zebras.`,
    };
    expect(matchedSearchSection(page, 'zebras')?.section).toEqual({ id: 'after', title: 'After' });
    // An `##` line inside the HTML block must not become a section (search skips `#` headings).
    const inHtml = { title: 'Guide', content: source.replace('# literal', '## literal') };
    expect(matchedSearchSection(inHtml, 'literal')).toBeUndefined();
  });

  it('cuts the section at the real heading, not at its repeat inside an HTML block (#593)', () => {
    const page = { title: 'Guide', content: HTML_BLOCK_REPEATED_HEADING };
    // One `After` heading, so its id has no duplicate suffix (`after-1`).
    expect(matchedSearchSection(page, 'zebras')).toEqual({ section: { id: 'after', title: 'After' }, snippet: 'The after section mentions zebras.' });
  });

  it('finds the section after lazy text after inline HTML in a list item, not the code after it', () => {
    const { source } = LAZY_TEXT_AFTER_INLINE_HTML;
    expect(
      matchedSearchSection(
        {
          title: 'Guide',
          content: `${source}

The after section mentions zebras.`,
        },
        'zebras',
      )?.section,
    ).toEqual({
      id: 'after',
      title: 'After',
    });
    // An `##` line in the fence must not become a section (search skips `#` headings).
    expect(matchedSearchSection({ title: 'Guide', content: source.replace('# literal', '## literal') }, 'literal')).toBeUndefined();
  });

  it.each(LAZY_INLINE_HTML_REPROS)('finds the section after %s, not the code after it (#590 lazy inline HTML)', (_name, example) => {
    const page = { title: 'Guide', content: `${example}\n\nThe after section mentions zebras.` };
    expect(matchedSearchSection(page, 'zebras')?.section).toEqual({ id: 'after', title: 'After' });
    // An `##` line in the fence must not become a section (search skips `#` headings).
    const inCode = { title: 'Guide', content: example.replace('# literal', '## literal') };
    expect(matchedSearchSection(inCode, 'literal')).toBeUndefined();
  });

  it.each(CONTINUATION_FENCE_REPROS)('finds the section after %s (#590 CodeRabbit)', (_name, example) => {
    const page = { title: 'Guide', content: `${example}\n\nThe after section mentions zebras.` };
    expect(matchedSearchSection(page, 'zebras')?.section).toEqual({ id: 'after', title: 'After' });
  });

  it('finds the section after indented code that looks like a fence, once a quote has ended (#590 council)', () => {
    const page = { title: 'Guide', content: `${INDENTED_FENCE_AFTER_QUOTE}\n\nThe after section mentions zebras.` };
    expect(matchedSearchSection(page, 'zebras')?.section).toEqual({ id: 'after', title: 'After' });
  });
});

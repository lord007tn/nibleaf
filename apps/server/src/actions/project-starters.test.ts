import { starterBodyHash } from '@nibleaf/auth/starter-body.server';
import { INTERFACE_LOCALES } from '@nibleaf/i18n/locales';
import { newsite_starter_welcome_content } from '@nibleaf/i18n/messages/newsite_starter_welcome_content';
import { describe, expect, it, vi } from 'vitest';
import { createStarterPages, hasRealPageContent } from './project-starters';

describe('first-publish content state', () => {
  it('does not complete editing for no pages, empty bodies, or navigation groups', () => {
    expect(hasRealPageContent([])).toBe(false);
    expect(hasRealPageContent([{ kind: 'PAGE', content: ' \n\t ' }])).toBe(false);
    expect(hasRealPageContent([{ kind: 'GROUP', content: 'Group name' }])).toBe(false);
  });

  it.each(INTERFACE_LOCALES)('excludes every new-site starter in $code, even after whitespace normalization', async ({ code }) => {
    for (const starter of ['blank', 'help-center', 'product-docs'] as const) {
      const pages: { kind: string; content: string }[] = [];
      const create = vi.fn(async ({ data }: { data: { content: string } }) => {
        pages.push({ kind: 'PAGE', content: `\n ${data.content.replace(/\n/g, '\r\n  ')} \n` });
        return { id: `page-${pages.length}` };
      });
      const baselineCreate = vi.fn();
      await createStarterPages(
        { page: { create }, projectStarterBaseline: { createMany: baselineCreate } } as never,
        'project',
        'branch',
        'language',
        code,
        starter,
      );
      expect(pages.length).toBeGreaterThan(0);
      const baselines = baselineCreate.mock.calls[0]?.[0].data;
      expect(baselines).toHaveLength(pages.length);
      expect(baselines.map((row: { bodyHash: string }) => row.bodyHash)).toEqual(pages.map((page) => starterBodyHash(page.content)));
      expect(hasRealPageContent(pages, baselines)).toBe(false);
      expect(hasRealPageContent(pages)).toBe(false);
    }
  });

  it('completes editing for authored content or an addition to a starter, regardless of title or path', () => {
    expect(hasRealPageContent([{ kind: 'PAGE', content: 'How to use our product.' }])).toBe(true);
    const starter = newsite_starter_welcome_content(undefined, { locale: 'ar' });
    expect(hasRealPageContent([{ kind: 'PAGE', content: `${starter}\n\nابدأ بإنشاء حسابك.` }])).toBe(true);
  });
});

describe('durable project starter body set', () => {
  const first = 'An original starter body.';
  const second = 'Another original starter body.';
  const baselines = [first, second].map((body) => ({ bodyHash: starterBodyHash(body) }));

  it('ignores empty bodies and groups even when a project has baselines', () => {
    expect(
      hasRealPageContent(
        [
          { kind: 'PAGE', content: ' \n ' },
          { kind: 'GROUP', content: 'Authored group' },
        ],
        baselines,
      ),
    ).toBe(false);
  });

  it('recognizes repeated and whitespace-normalized bodies in the project set', () => {
    const pages = [first, second, first, second].map((content) => ({ kind: 'PAGE', content }));
    expect(hasRealPageContent(pages, baselines)).toBe(false);
    expect(hasRealPageContent([{ kind: 'PAGE', content: second }], baselines)).toBe(false);
    expect(hasRealPageContent([{ kind: 'PAGE', content: ` \n${first.replaceAll(' ', '  \t')}\r\n` }], baselines)).toBe(false);
  });

  it('counts one real edit and authored/imported bodies regardless of starter-like routes', () => {
    expect(
      hasRealPageContent(
        [
          { kind: 'PAGE', content: first },
          { kind: 'PAGE', content: `${second} Real edit.` },
        ],
        baselines,
      ),
    ).toBe(true);
    // A current catalog body is real content if it was not in this project's initial set.
    expect(hasRealPageContent([{ kind: 'PAGE', content: newsite_starter_welcome_content(undefined, { locale: 'en' }) }], baselines)).toBe(true);
  });
});

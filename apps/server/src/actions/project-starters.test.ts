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
      await createStarterPages({ page: { create } } as never, 'project', 'branch', 'language', code, starter);
      expect(pages.length).toBeGreaterThan(0);
      expect(hasRealPageContent(pages)).toBe(false);
    }
  });

  it('completes editing for authored content or an addition to a starter, regardless of title or path', () => {
    expect(hasRealPageContent([{ kind: 'PAGE', content: 'How to use our product.' }])).toBe(true);
    const starter = newsite_starter_welcome_content(undefined, { locale: 'ar' });
    expect(hasRealPageContent([{ kind: 'PAGE', content: `${starter}\n\nابدأ بإنشاء حسابك.` }])).toBe(true);
  });
});

import { starterBodyHash } from '@nibleaf/auth/starter-body.server';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ welcome: 'Original localized welcome body.' }));
vi.mock('@nibleaf/i18n/messages/newsite_starter_welcome_content', () => ({
  newsite_starter_welcome_content: () => fixture.welcome,
}));

afterEach(() => {
  fixture.welcome = 'Original localized welcome body.';
  vi.resetModules();
});

it('keeps an untouched starter unedited after the localized catalog changes', async () => {
  const original = await import('./project-starters');
  const pages: { kind: string; content: string }[] = [];
  const baselines: { bodyHash: string }[] = [];
  const tx = {
    page: {
      create: vi.fn(async ({ data }: { data: { content: string } }) => {
        pages.push({ kind: 'PAGE', content: data.content });
        return { id: 'page-fictional-1' };
      }),
    },
    projectStarterBaseline: {
      createMany: vi.fn(async ({ data }: { data: { bodyHash: string }[] }) => baselines.push(...data)),
    },
  };
  await original.createStarterPages(tx as never, 'project-fictional-1', 'branch-fictional-1', 'language-fictional-1', 'ar', 'blank');
  expect(original.hasRealPageContent(pages)).toBe(false);
  fixture.welcome = 'Changed localized welcome body in a later release.';
  vi.resetModules();
  const later = await import('./project-starters');
  // Sensitivity control: the exact legacy catalog fallback reproduces the bug.
  expect(later.hasRealPageContent(pages)).toBe(true);
  expect(later.hasRealPageContent(pages, baselines)).toBe(false);
  expect(baselines).toEqual([{ projectId: 'project-fictional-1', starterKey: 'ar/welcome', bodyHash: starterBodyHash(pages[0]?.content ?? '') }]);
  expect(later.hasRealPageContent([{ kind: 'PAGE', content: `${pages[0]?.content} Writer's addition.` }], baselines)).toBe(true);
});

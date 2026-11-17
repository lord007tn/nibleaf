import { MAX_PAGE_CONTENT_BYTES } from '@nibleaf/shared/page-limits';
import { afterEach, expect, it, vi } from 'vitest';
import { GitBookImportBudget } from './gitbook-budget';
import { expandGitBookIncludes } from './gitbook-markdown';

// Some tests here work through large generated case sets or whole documentation
// corpora. On a loaded CI runner such tests have taken ~28x as long as on a laptop
// (5.5 s against 0.19 s), past Vitest's 5 s default, so the file gets an explicit
// timeout. Their cost stays linear; the *.growth.test.ts files pin that.
vi.setConfig({ testTimeout: 60_000 });

afterEach(() => vi.useRealTimers());

it('bounds source count, aggregate bytes, and elapsed time independently', () => {
  const count = new GitBookImportBudget();
  for (let i = 0; i < 4000; i++) count.source('');
  expect(() => count.source('')).toThrow(/source budget/);
  const bytes = new GitBookImportBudget();
  const chunk = 'x'.repeat(1024 * 1024);
  for (let i = 0; i < 32; i++) bytes.source(chunk);
  expect(() => bytes.source('x')).toThrow(/source budget/);
  vi.useFakeTimers();
  const timed = new GitBookImportBudget();
  vi.advanceTimersByTime(600_001);
  expect(() => timed.check()).toThrow(/time budget/);
});

it('bounds include fanout even when every file is tiny', async () => {
  const load = vi.fn(async () => 'text');
  await expect(expandGitBookIncludes('{% include "part.md" %}'.repeat(10_001), 'page.md', () => 'part.md', load, [])).rejects.toThrow(
    /include budget/,
  );
  expect(load).toHaveBeenCalledTimes(10_000);
});

it('bounds cumulative expanded bytes across pages', async () => {
  const budget = new GitBookImportBudget();
  budget.expansion('x'.repeat(64 * 1024 * 1024));
  await expect(
    expandGitBookIncludes(
      '{% include "part.md" %}',
      'page.md',
      () => 'part.md',
      async () => 'x',
      [],
      ['page.md'],
      budget,
    ),
  ).rejects.toThrow(/expansion budget/);
});

it('stops expansion before accumulating all include replacements', async () => {
  const load = vi.fn(async () => 'x'.repeat(1024 * 1024));
  await expect(expandGitBookIncludes('{% include "part.md" %}'.repeat(100), 'page.md', () => 'part.md', load, [])).rejects.toThrow(
    /expansion budget/,
  );
  expect(load.mock.calls.length).toBeLessThanOrEqual(65);
});

it('bounds each expanded page independently of cumulative work', () => {
  const budget = new GitBookImportBudget();
  // The same cap as every other page write, measured in UTF-8 bytes.
  expect(MAX_PAGE_CONTENT_BYTES).toBe(2 * 1024 * 1024);
  expect(() => budget.page('x'.repeat(MAX_PAGE_CONTENT_BYTES), 'limit.md')).not.toThrow();
  expect(() => budget.page('x'.repeat(MAX_PAGE_CONTENT_BYTES + 1), 'big.md')).toThrow(/Expanded page/);
  expect(() => budget.page('ع'.repeat(MAX_PAGE_CONTENT_BYTES / 2 + 1), 'arabic.md')).toThrow(/Expanded page/);
});

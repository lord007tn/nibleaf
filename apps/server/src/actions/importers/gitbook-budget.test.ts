import { afterEach, expect, it, vi } from 'vitest';
import { GitBookImportBudget } from './gitbook-budget';
import { expandGitBookIncludes } from './gitbook-markdown';

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
  expect(() => budget.page('x'.repeat(2 * 1024 * 1024 + 1), 'big.md')).toThrow(/Expanded page/);
});

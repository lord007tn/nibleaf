/** @vitest-environment jsdom */
/**
 * Expand timing for a 313-page site (120 children in one group). Not part of
 * the unit suite, because timings are noisy under a loaded run. Run on demand:
 * `pnpm --filter @nibleaf/app bench:page-tree`. The behaviour is covered by
 * `page-tree-expand.test.tsx`.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LargeTree, largeTreePages } from './page-tree-large-fixture';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('measures expanding 120 children in a 313-page site', async () => {
  localStorage.setItem('nibleaf.editor.collapsedGroups:en', '["page-0"]');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LargeTree pages={largeTreePages()} onAction={() => undefined} />));
    const samples: number[] = [];
    for (let run = 0; run < 6; run++) {
      const button = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
      expect(button).not.toBeNull();
      const start = performance.now();
      await act(async () => button?.click());
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1500);
      // Warm-up excluded from the median.
      if (run > 0) samples.push(elapsed);
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.click());
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    console.info(`TREE_TIMING median_ms=${median.toFixed(1)} samples=${samples.map((n) => n.toFixed(1)).join(',')}`);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
  }
});

/** @vitest-environment jsdom */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { PageNode } from '@/hooks/api';
import { PageTreeDndProvider, SortablePageTree } from './sortable-page-tree';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('measures expanding 120 children in a 313-page site', async () => {
  const pages = Array.from({ length: 313 }, (_, i) => ({
    id: `page-${i}`,
    title: `Page ${i}`,
    slug: `page-${i}`,
    path: `page-${i}`,
    parentId: i > 0 && i <= 120 ? 'page-0' : null,
    languageId: i <= 120 ? 'en' : 'ar',
    position: i,
    kind: i === 0 ? 'GROUP' : 'PAGE',
    icon: null,
    description: null,
    hidden: false,
    updatedAt: '',
  })) as PageNode[];
  localStorage.setItem('nibleaf.editor.collapsedGroups:en', '["page-0"]');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const commits: number[] = [];
  const noop = vi.fn();
  try {
    await act(async () =>
      root.render(
        <Profiler id="tree" onRender={(_id, _phase, duration) => commits.push(duration)}>
          <PageTreeDndProvider
            pages={pages}
            languages={[
              { id: 'en', label: 'English', collapsed: false },
              { id: 'ar', label: 'Arabic', collapsed: true },
            ]}
            dir="ltr"
            onMove={noop}
          >
            <SortablePageTree languageId="en" activeId={null} onSelect={noop} onAddChild={noop} onSettings={noop} />
            <SortablePageTree languageId="ar" activeId={null} onSelect={noop} onAddChild={noop} onSettings={noop} />
          </PageTreeDndProvider>
        </Profiler>,
      ),
    );
    const samples: number[] = [];
    for (let run = 0; run < 6; run++) {
      const button = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
      expect(button).not.toBeNull();
      commits.length = 0;
      const start = performance.now();
      await act(async () => button?.click());
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1500);
      if (run > 0) samples.push(elapsed);
      console.info(`TREE_TIMING run=${run} expand_ms=${elapsed.toFixed(1)} react_ms=${commits.reduce((a, b) => a + b, 0).toFixed(1)}`);
      expect(container.textContent).toContain('Page 120');
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.click());
    }
    samples.sort((a, b) => a - b);
    writeFileSync(join(tmpdir(), 'nibleaf-page-tree-timing.json'), JSON.stringify({ samples, median: samples[2] }));
    console.info(`TREE_TIMING median_ms=${samples[2]?.toFixed(1)} samples=${samples.map((n) => n.toFixed(1)).join(',')}`);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
  }
});

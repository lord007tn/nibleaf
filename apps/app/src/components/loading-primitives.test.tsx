// @vitest-environment jsdom

import { SkeletonTableRows, SkeletonText } from '@nibleaf/design-system/components/ui/skeleton';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

describe('Skeleton building blocks', () => {
  it('hides placeholders from assistive tech and respects reduced motion', async () => {
    const container = await render(<SkeletonText lines={3} />);
    const block = container.firstElementChild;
    expect(block?.getAttribute('aria-hidden')).toBe('true');
    const lines = block?.querySelectorAll('[data-slot="skeleton"]') ?? [];
    expect(lines.length).toBe(3);
    expect(lines[0]?.className).toContain('motion-reduce:animate-none');
  });

  it('renders table rows with the requested column count', async () => {
    const container = await render(
      <table>
        <tbody>
          <SkeletonTableRows columns={4} rows={2} />
        </tbody>
      </table>,
    );
    const rows = container.querySelectorAll('tr');
    expect(rows.length).toBe(2);
    expect(rows[0]?.querySelectorAll('td').length).toBe(4);
  });
});

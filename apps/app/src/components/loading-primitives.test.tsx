// @vitest-environment jsdom

import { Button } from '@nibleaf/design-system/components/ui/button';
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

describe('Button loading', () => {
  it('renders exactly as before when `loading` is not used', async () => {
    const container = await render(<Button>Save</Button>);
    const button = container.querySelector('button');
    expect(button?.textContent).toBe('Save');
    expect(button?.firstElementChild).toBeNull();
    expect(button?.hasAttribute('aria-busy')).toBe(false);
  });

  it('disables the button, marks it busy and keeps the label in the layout', async () => {
    const onClick = vi.fn();
    const container = await render(
      <Button loading onClick={onClick}>
        Publish now
      </Button>,
    );
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.hasAttribute('data-loading')).toBe(true);
    // The label stays (invisible) so the width doesn't change; without loadingText
    // it also stays the accessible name.
    const label = [...(button?.querySelectorAll('span') ?? [])].filter((span) => span.textContent === 'Publish now').at(-1);
    expect(label?.className).toContain('invisible');
    expect(label?.getAttribute('aria-hidden')).toBeNull();
    expect(button?.querySelector('svg')).not.toBeNull();
    await act(async () => button?.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows loadingText as the visible and accessible text while loading', async () => {
    const container = await render(
      <Button loading loadingText="Creating…">
        Create site
      </Button>,
    );
    const spans = [...(container.querySelectorAll('button span') ?? [])];
    expect(spans.find((span) => span.textContent === 'Create site')?.getAttribute('aria-hidden')).toBe('true');
    expect(spans.some((span) => span.textContent === 'Creating…' && !span.closest('[aria-hidden="true"]'))).toBe(true);
  });

  it('keeps the same structure when loading toggles off, so nothing reflows', async () => {
    const container = await render(<Button loading={false}>Save</Button>);
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(false);
    expect(button?.hasAttribute('aria-busy')).toBe(false);
    expect(button?.querySelectorAll('svg').length).toBe(1);
  });
});

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

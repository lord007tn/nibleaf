// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => `[${key}]` }));

import { RangeTabs } from './range-tabs';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<ReturnType<typeof createRoot>> = [];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
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

describe('RangeTabs', () => {
  it('labels every range with its translated message, never the raw enum value', async () => {
    const container = await render(<RangeTabs value="30d" onValueChange={() => undefined} />);
    const group = container.querySelector('[role="group"]');
    const tabs = [...container.querySelectorAll('button')];

    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '[analytics.range.24h]',
      '[analytics.range.7d]',
      '[analytics.range.30d]',
      '[analytics.range.90d]',
    ]);
    // A filter, not tabs: a named group of pressed-state buttons.
    expect(group?.getAttribute('aria-label')).toBe('[analytics.range.label]');
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(tabs.map((tab) => tab.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false']);
    expect(tabs.map((tab) => tab.textContent)).not.toContain('30d');
  });

  it('reports the chosen range to the owner of the filter state', async () => {
    const onValueChange = vi.fn();
    const container = await render(<RangeTabs value="30d" onValueChange={onValueChange} />);

    await act(async () => container.querySelectorAll<HTMLElement>('button')[3]?.click());

    expect(onValueChange).toHaveBeenCalledWith('90d');
  });

  it('marks no preset pressed while a custom range is active', async () => {
    const container = await render(<RangeTabs value={null} onValueChange={() => undefined} />);

    expect([...container.querySelectorAll('button')].every((tab) => tab.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('renders only the ranges a surface asks for', async () => {
    const container = await render(<RangeTabs value="7d" onValueChange={() => undefined} ranges={['7d', '30d', '90d']} />);

    expect(container.querySelectorAll('button')).toHaveLength(3);
    expect(container.textContent).not.toContain('[analytics.range.24h]');
  });
});

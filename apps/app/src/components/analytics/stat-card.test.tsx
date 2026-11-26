// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/format', () => ({ useFormatters: () => ({ number: (value: number) => String(value), percent: (value: number) => `${value}%` }) }));
vi.mock('./insights/kpi-card', () => ({ DeltaBadge: () => <span data-testid="delta">+207%</span> }));

import { StatCard } from './stat-card';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const container = document.createElement('div');
const root = createRoot(container);
afterEach(async () => {
  await act(async () => root.render(null));
});

describe('StatCard change badge (WORKSPACE-23)', () => {
  it('puts the change on the footer line with its comparison, never in the header corner beside the label', async () => {
    await act(async () =>
      root.render(<StatCard delta={{ mode: 'percent', amount: 207, direction: 'up' }} hint="vs. previous period" label="Page views" value={2522} />),
    );
    const delta = container.querySelector('[data-testid="delta"]');
    expect(delta?.closest('[data-slot="card-header"]')).toBeNull();
    expect(delta?.closest('[data-slot="card-footer"]')?.textContent).toContain('vs. previous period');
    expect(container.querySelector('[data-slot="card-action"]')).toBeNull();
  });

  it('shows no footer while loading or with nothing to say', async () => {
    await act(async () => root.render(<StatCard label="Pages" value={6} />));
    expect(container.querySelector('[data-slot="card-footer"]')).toBeNull();
    await act(async () => root.render(<StatCard delta={{ mode: 'percent', amount: 3, direction: 'up' }} label="Views" loading value={null} />));
    expect(container.querySelector('[data-slot="card-footer"]')).toBeNull();
  });

  it('dims and marks busy a figure that belongs to the previous range', async () => {
    await act(async () => root.render(<StatCard label="Page views" refreshing value={10} />));
    const card = container.querySelector('[data-slot="card"]');
    expect(card?.getAttribute('aria-busy')).toBe('true');
    expect(card?.className).toContain('opacity-60');
  });
});

// @vitest-environment jsdom

import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

const TONES = ['neutral', 'info', 'success', 'warning', 'danger', 'pending'] as const;

describe('StatusBadge', () => {
  it('always shows its label and hides the dot from assistive tech', async () => {
    const container = await render(<StatusBadge tone="success">Active</StatusBadge>);
    const badge = container.querySelector('[data-slot="status-badge"]');
    expect(badge?.getAttribute('data-tone')).toBe('success');
    expect(badge?.textContent).toBe('Active');
    const dot = badge?.querySelector('[data-slot="status-badge-dot"]');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(dot?.className).toContain('bg-success');
  });

  it('pulses only the pending dot, and only when motion is allowed', async () => {
    const container = await render(
      <>
        <StatusBadge tone="pending">Verifying</StatusBadge>
        <StatusBadge tone="info">Queued</StatusBadge>
      </>,
    );
    const [pending, info] = container.querySelectorAll('[data-slot="status-badge-dot"]');
    expect(pending?.className).toContain('motion-safe:animate-pulse');
    expect(pending?.className).not.toMatch(/(^|\s)animate-pulse/);
    expect(info?.className).not.toContain('animate-pulse');
  });

  it('replaces the dot with an icon, still hidden from assistive tech', async () => {
    const container = await render(
      <StatusBadge tone="warning" icon={<svg />}>
        Expiring
      </StatusBadge>,
    );
    expect(container.querySelector('[data-slot="status-badge-dot"]')).toBeNull();
    const icon = container.querySelector('[data-slot="status-badge-icon"]');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toBe('Expiring');
  });

  it('uses theme tokens, never palette literals', async () => {
    const container = await render(
      <div>
        {TONES.map((tone) => (
          <StatusBadge key={tone} tone={tone} size="sm">
            {tone}
          </StatusBadge>
        ))}
      </div>,
    );
    expect(container.querySelectorAll('[data-slot="status-badge"]')).toHaveLength(TONES.length);
    const classes = [...container.querySelectorAll('*')].map((el) => el.getAttribute('class') ?? '').join(' ');
    expect(classes).not.toMatch(/\b(?:bg|text|border)-(?:emerald|amber|sky|green|red|yellow|blue|orange|rose)-\d/);
  });
});

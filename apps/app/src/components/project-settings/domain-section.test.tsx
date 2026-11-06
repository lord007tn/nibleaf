// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';
import { DomainSection } from './domain-section';

const mocks = vi.hoisted(() => ({ verify: { isPending: true, variables: 'domain-a', mutate: vi.fn() }, domainsPending: false }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/hooks/api', () => ({
  useDomains: () =>
    mocks.domainsPending
      ? { data: undefined, isPending: true }
      : {
          data: ['a', 'b'].map((id) => ({
            id: `domain-${id}`,
            domain: `${id}.example.com`,
            dnsStatus: 'PENDING',
            sslStatus: 'PENDING',
            dnsRecords: [],
          })),
        },
  useVerifyDomain: () => mocks.verify,
  useAddDomain: () => ({ mutate: vi.fn() }),
  useDeleteDomain: () => ({ mutate: vi.fn() }),
  useSetPrimaryDomain: () => ({ mutate: vi.fn() }),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
it('shows verification progress only on its domain and renders three independent guide steps', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<DomainSection project={{ id: 'site-1' } as Project} />));
    const rows = [...container.querySelectorAll('[data-slot="collapsible"]')];
    expect(rows).toHaveLength(2);
    const [firstRow, secondRow] = rows;
    if (!firstRow || !secondRow) throw new Error('Expected two domain rows');
    const first = [...firstRow.querySelectorAll('button')].find((b) => b.textContent?.includes('common.loading'));
    expect(first?.disabled).toBe(true);
    const second = [...secondRow.querySelectorAll('button')].find((b) => b.textContent?.includes('settings.domain.retry'));
    expect(second?.disabled).toBe(false);
    expect(secondRow.querySelector('button[aria-busy="true"]')).toBeNull();
    expect(first?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect([...container.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual([
      'settings.domain.guide.step1',
      'settings.domain.guide.step2',
      'settings.domain.guide.step3',
    ]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('loads in the shape of the section: guide steps, the add row and domain cards, announced once', async () => {
  mocks.domainsPending = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<DomainSection project={{ id: 'site-1' } as Project} />));
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    // Card-shaped placeholders, not a stack of labelled form fields.
    expect(container.querySelectorAll('.rounded-xl.border')).toHaveLength(2);
  } finally {
    mocks.domainsPending = false;
    await act(async () => root.unmount());
    container.remove();
  }
});

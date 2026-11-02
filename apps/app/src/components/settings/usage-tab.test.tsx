// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';

const mocks = vi.hoisted(() => ({ usage: vi.fn(), refetch: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/hooks/api', () => ({ useProjectUsage: mocks.usage }));

import { UsageTab } from './usage-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('UsageTab request recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('replaces loading placeholders with a retry action after a request fails', async () => {
    mocks.usage.mockReturnValue({ isPending: false, isError: true, refetch: mocks.refetch });
    await act(async () => root.render(<UsageTab project={{ id: 'project-1' } as Project} />));

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});

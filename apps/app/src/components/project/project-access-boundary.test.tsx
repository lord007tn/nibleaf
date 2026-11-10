// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { ProjectAccessBoundary } from './project-access-boundary';

let query: {
  data?: { id: string; name?: string; organizationId?: string };
  error: Error | null;
  isPending: boolean;
  refetch: ReturnType<typeof vi.fn>;
};
const lostWebsite = vi.fn();
vi.mock('@/hooks/api', () => ({
  useProject: () => query,
  useOrganizationOfProject: (organizationId?: string) => ({ organization: organizationId ? { slug: 'acme' } : undefined }),
}));
vi.mock('@/components/organization/use-access-loss', () => ({ useAccessLoss: () => ({ lostWebsite }) }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe('project access boundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  const mountTools = vi.fn();
  const queryClient = new QueryClient();
  function Tools() {
    mountTools();
    return <textarea defaultValue="Unsaved draft" />;
  }
  const render = () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProjectAccessBoundary projectId="project-a">
            <Tools />
          </ProjectAccessBoundary>
        </QueryClientProvider>,
      ),
    );

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    query = { error: null, isPending: true, refetch: vi.fn() };
    mountTools.mockClear();
    lostWebsite.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not mount tools or their queries until a project is accessible', async () => {
    await render();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(mountTools).not.toHaveBeenCalled();
    query = { ...query, data: { id: 'project-a' }, isPending: false };
    await render();
    expect(container.querySelector('textarea')?.value).toBe('Unsaved draft');
  });

  it.each([401, 403, 404])('hides cached project tools when access returns %i', async (status) => {
    query = { ...query, data: { id: 'project-a' }, isPending: false };
    await render();
    query = { ...query, error: new ApiResponseError('Private server detail', status) };
    await render();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).toContain('notFound.title');
    expect(container.textContent).not.toContain('Private server detail');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/app');
  });

  it.each([403, 404])('names a website you lost access to while viewing (%i) and returns to its org', async (status) => {
    query = { ...query, data: { id: 'project-a', name: 'API reference', organizationId: 'org-1' }, isPending: false };
    await render();
    query = { ...query, error: new ApiResponseError('Private server detail', status) };
    await render();
    expect(container.querySelector('textarea')).toBeNull();
    // The name comes from the client cache, never from the server's error.
    expect(lostWebsite).toHaveBeenCalledWith('API reference', 'acme');
    expect(container.textContent).not.toContain('Private server detail');
  });

  it('preserves an open draft during a transient background failure', async () => {
    query = { ...query, data: { id: 'project-a' }, isPending: false };
    await render();
    const draft = container.querySelector('textarea');
    query = { ...query, error: new ApiResponseError('Unavailable', 503) };
    await render();
    expect(container.querySelector('textarea')).toBe(draft);
  });

  it('offers retry after an initial network failure without mounting project tools', async () => {
    query = { ...query, isPending: false, error: new Error('Private server detail') };
    await render();
    expect(mountTools).not.toHaveBeenCalled();
    expect(container.textContent).toContain('error.unexpected');
    expect(container.textContent).not.toContain('Private server detail');
    await act(async () => container.querySelector('button')?.click());
    expect(query.refetch).toHaveBeenCalledOnce();
  });
});

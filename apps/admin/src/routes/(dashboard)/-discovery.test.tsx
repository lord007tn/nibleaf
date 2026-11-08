// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  path: '/users',
  options: vi.fn(),
  error: false,
  retry: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({ options }),
  useRouterState: () => mocks.path,
  Link: ({ children }: { children: ReactNode }) => <a href="/synthetic">{children}</a>,
  Outlet: () => null,
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn(), usePrompt: () => vi.fn() }));
vi.mock('@/lib/format', () => ({ useFormatters: () => ({ number: String, relative: () => 'now' }) }));
vi.mock('@/hooks/api/mutations', () => ({
  useSetUserRole: () => ({}),
  useSuspendUser: () => ({}),
  useTakedownSite: () => ({}),
  useInviteOrganization: () => ({}),
}));
vi.mock('@/hooks/api/queries', () => {
  const query = (options: unknown) => {
    mocks.options(options);
    return { data: { items: [], total: 505, nextCursor: 'next-50' }, isError: mocks.error, isPending: false, refetch: mocks.retry };
  };
  return {
    useAdminUsers: query,
    useAdminSites: query,
    useAdminOperations: (options: unknown) => {
      mocks.options(options);
      return {
        data: {
          deployments: [],
          domains: [],
          exports: [],
          git: [],
          totals: { deployments: 101, domains: 101, exports: 51, git: 51 },
          issueCounts: { deploymentIssues: 101, domainIssues: 101, exportIssues: 51, gitIssues: 51 },
          nextCursor: { deployments: 'next-50' },
        },
        isError: mocks.error,
        isPending: false,
        refetch: mocks.retry,
      };
    },
  };
});

import { Route as Operations } from './operations';
import { Route as Sites } from './sites';
import { Route as Users } from './users';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  mocks.error = false;
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const click = async (label: string) => {
  const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button?.click());
};

it.each([
  ['/users', Users],
  ['/sites', Sites],
] as const)('resets the %s cursor when search changes and exposes retry on failures', async (path, route) => {
  mocks.path = path;
  const Page = route.options.component as unknown as ComponentType;
  await act(async () => root.render(<Page />));
  await click('admin.pagination.next');
  expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next-50' }));
  const input = container.querySelector('input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'عميل قديم');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'عميل قديم', cursor: undefined }));
  mocks.error = true;
  await act(async () => root.render(<Page />));
  await click('common.retry');
  expect(mocks.retry).toHaveBeenCalledOnce();
});

it('requests unresolved operations before paging and resets continuation when toggled', async () => {
  const Page = Operations.options.component as unknown as ComponentType;
  await act(async () => root.render(<Page />));
  await click('admin.pagination.next');
  expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next-50' }));
  await click('admin.operations.issuesOnly');
  expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining({ onlyIssues: true, cursor: undefined }));
  expect(container.textContent).toContain('101');
});
